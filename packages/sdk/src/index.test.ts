import { describe, expect, it, vi } from "vitest";
import { DeskbellClient, DeskbellError } from "./index";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const body = (call: Call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>;

describe("DeskbellClient", () => {
  it("calls fetch as a free function, the way a browser's native fetch requires", async () => {
    // A native fetch throws "Illegal invocation" when called with any other
    // receiver; this fake does the same, so a regression cannot pass in Node.
    const strict = function (this: unknown, ..._args: Parameters<typeof fetch>) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(json({ conversations: [] }));
    } as unknown as typeof fetch;
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: strict });
    await expect(client.conversations.list()).resolves.toEqual([]);
    const original = globalThis.fetch;
    globalThis.fetch = strict;
    try {
      const bare = new DeskbellClient({ projectKey: "pk", sessionId: "s" });
      await expect(bare.conversations.list()).resolves.toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("posts projectKey and sessionId with every session request", async () => {
    const f = fakeFetch(() => json({ conversations: [{ id: "c1" }] }));
    const client = new DeskbellClient({
      baseUrl: "https://d.example",
      projectKey: "pk_1",
      sessionId: "s1",
      fetch: f.fetch,
    });
    const list = await client.conversations.list();
    expect(list).toEqual([{ id: "c1" }]);
    expect(f.calls[0]?.url).toBe("https://d.example/api/v1/conversations");
    expect(body(f.calls[0] as Call)).toEqual({ projectKey: "pk_1", sessionId: "s1" });
  });

  it("resolves a lazy session once, on first use", async () => {
    const mint = vi.fn(() => "lazy");
    const f = fakeFetch(() => json({ messages: [] }));
    const client = new DeskbellClient({ projectKey: "pk", sessionId: mint, fetch: f.fetch });
    expect(mint).not.toHaveBeenCalled();
    await client.conversations.messages("c1");
    await client.feedback({ messageId: "m", feedback: "up" });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(body(f.calls[1] as Call)).toMatchObject({ sessionId: "lazy", messageId: "m" });
  });

  it("streams ask events and passes the abort signal to fetch", async () => {
    const f = fakeFetch(
      () =>
        new Response('data: {"type":"token","value":"hi"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: f.fetch });
    const controller = new AbortController();
    const events = [];
    for await (const e of client.ask({ message: "q" }, { signal: controller.signal }))
      events.push(e);
    expect(events).toEqual([{ type: "token", value: "hi" }]);
    expect(f.calls[0]?.init?.signal).toBe(controller.signal);
    expect(body(f.calls[0] as Call)).toEqual({ projectKey: "pk", sessionId: "s", message: "q" });
  });

  it("maps a 429 to DeskbellError with retryAfter", async () => {
    const f = fakeFetch(() => new Response("", { status: 429, headers: { "retry-after": "12" } }));
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: f.fetch });
    const run = async () => {
      for await (const _ of client.ask({ message: "q" })) {
        // never reached
      }
    };
    await expect(run()).rejects.toMatchObject({
      name: "DeskbellError",
      status: 429,
      retryAfter: 12,
    });
  });

  it("fetches config without a session and surfaces failures", async () => {
    const f = fakeFetch((call) =>
      call.url.endsWith("key=pk_1") ? json({ accent: "#000" }) : new Response("", { status: 404 }),
    );
    const client = new DeskbellClient({ projectKey: "pk_1", fetch: f.fetch });
    await expect(client.config()).resolves.toEqual({ accent: "#000" });
    const missing = new DeskbellClient({ projectKey: "nope", fetch: f.fetch });
    await expect(missing.config()).rejects.toBeInstanceOf(DeskbellError);
    await expect(missing.conversations.list()).rejects.toMatchObject({ status: 0 });
  });

  it("sends the bearer on every request when the visitor has a token", async () => {
    const f = fakeFetch(() => json({ conversations: [] }));
    const client = new DeskbellClient({
      projectKey: "pk",
      sessionId: "s",
      getAuthToken: async () => "tok",
      fetch: f.fetch,
    });
    await client.conversations.list({ scope: { key: "site", id: "42" }, limit: 5 });
    await client.config();
    const headers = (i: number) => f.calls[i]?.init?.headers as Record<string, string>;
    expect(headers(0).authorization).toBe("Bearer tok");
    expect(headers(1).authorization).toBe("Bearer tok");
    expect(headers(1)["content-type"]).toBeUndefined();
    expect(body(f.calls[0] as Call)).toEqual({
      projectKey: "pk",
      sessionId: "s",
      scope: { key: "site", id: "42" },
      limit: 5,
    });
  });

  it("omits the header when the token provider returns nothing", async () => {
    const f = fakeFetch(() => json({ messages: [] }));
    const client = new DeskbellClient({
      projectKey: "pk",
      sessionId: "s",
      getAuthToken: () => null,
      fetch: f.fetch,
    });
    await client.conversations.messages("c");
    expect(
      (f.calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined();
  });

  it("deletes and renames through their own endpoints", async () => {
    const f = fakeFetch(() => json({ ok: true }));
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: f.fetch });
    await client.conversations.delete("c1");
    await client.conversations.rename("c1", "Exports");
    expect(f.calls[0]?.url).toBe("/api/v1/conversations/delete");
    expect(body(f.calls[0] as Call)).toEqual({
      projectKey: "pk",
      sessionId: "s",
      conversationId: "c1",
    });
    expect(f.calls[1]?.url).toBe("/api/v1/conversations/rename");
    expect(body(f.calls[1] as Call)).toMatchObject({ conversationId: "c1", title: "Exports" });
  });

  it("attaches context to a new conversation", async () => {
    const f = fakeFetch(
      () => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: f.fetch });
    for await (const _ of client.ask({
      message: "q",
      context: { site: { id: "42", name: "Shop" } },
    })) {
      // empty stream
    }
    expect(body(f.calls[0] as Call).context).toEqual({ site: { id: "42", name: "Shop" } });
  });

  it("requests a staff preview of one conversation", async () => {
    const f = fakeFetch(() => json({ conversation: { id: "c1" }, endUser: null, messages: [] }));
    const client = new DeskbellClient({ projectKey: "pk", sessionId: "s", fetch: f.fetch });
    await expect(client.conversations.preview("c1")).resolves.toMatchObject({ endUser: null });
    expect(f.calls[0]?.url).toBe("/api/v1/conversations/preview");
    expect(body(f.calls[0] as Call)).toEqual({
      projectKey: "pk",
      sessionId: "s",
      conversationId: "c1",
    });
  });

  it("pings with only the project key", async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    const client = new DeskbellClient({ projectKey: "pk", fetch: f.fetch });
    await client.ping();
    expect(f.calls[0]?.url).toBe("/api/v1/ping");
    expect(body(f.calls[0] as Call)).toEqual({ projectKey: "pk" });
  });
});
