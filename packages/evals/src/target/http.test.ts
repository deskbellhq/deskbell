import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvalCase } from "../types";
import { createHttpTarget } from "./http";

const evalCase: EvalCase = {
  id: "c",
  question: "q",
  kind: "answerable",
  expectedFacts: ["alpha"],
};

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function limited(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "Rate limited" }), {
    status: 429,
    headers: { "retry-after": String(retryAfter) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createHttpTarget", () => {
  it("assembles tokens and citations from the event stream", async () => {
    vi.stubGlobal("fetch", async () =>
      sse([
        { type: "citations", citations: [{ documentId: "d1", title: "T", snippet: "s" }] },
        { type: "token", value: "alpha " },
        { type: "token", value: "beta" },
        { type: "done", conversationId: "c", messageId: "m" },
      ]),
    );

    const answer = await createHttpTarget({
      apiUrl: "http://x",
      projectKey: "pk",
      origin: "http://x",
    }).ask(evalCase);

    expect(answer.answer).toBe("alpha beta");
    expect(answer.citedDocumentIds).toEqual(["d1"]);
    expect(answer.refused).toBe(false);
  });

  it("reports a refusal without inventing an answer", async () => {
    vi.stubGlobal("fetch", async () => sse([{ type: "refusal", reason: "no_grounding" }]));

    const answer = await createHttpTarget({
      apiUrl: "http://x",
      projectKey: "pk",
      origin: "http://x",
    }).ask(evalCase);

    expect(answer.refused).toBe(true);
    expect(answer.refusalReason).toBe("no_grounding");
  });

  it("reads the names a verification event carries, and stays null without one", async () => {
    // The wire sends the event only when names were found wanting, so a clean
    // answer and an unchecked one look the same here (spec: answer-verification).
    vi.stubGlobal("fetch", async () =>
      sse([
        { type: "token", value: "alpha" },
        { type: "verification", unsupportedTerms: ["Made Up"] },
        { type: "done", conversationId: "c", messageId: "m" },
      ]),
    );
    const target = createHttpTarget({ apiUrl: "http://x", projectKey: "pk", origin: "http://x" });
    expect((await target.ask(evalCase)).unsupportedTerms).toEqual(["Made Up"]);

    vi.stubGlobal("fetch", async () => sse([{ type: "token", value: "alpha" }]));
    expect((await target.ask(evalCase)).unsupportedTerms).toBeNull();
  });

  it("refuses a case with history rather than replaying it wrongly", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const target = createHttpTarget({ apiUrl: "http://x", projectKey: "pk", origin: "http://x" });
    await expect(
      target.ask({ ...evalCase, history: [{ role: "user", content: "earlier" }] }),
    ).rejects.toThrow(/history/);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("never reports retrieval or cost, which the wire does not carry", async () => {
    // Estimating either from citation snippets would read as a measurement.
    vi.stubGlobal("fetch", async () => sse([{ type: "token", value: "alpha" }]));

    const answer = await createHttpTarget({
      apiUrl: "http://x",
      projectKey: "pk",
      origin: "http://x",
    }).ask(evalCase);

    expect(answer.retrieved).toBeNull();
    expect(answer.usage).toEqual({ input: 0, output: 0, embedding: 0 });
  });

  it("waits out a rate limit for exactly as long as the server asks", async () => {
    // An eval run replays questions as fast as it can, which is the traffic
    // shape the abuse guard exists to stop — being limited is the normal case.
    const waits: number[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return calls === 1 ? limited(3) : sse([{ type: "token", value: "alpha" }]);
    });

    const answer = await createHttpTarget({
      apiUrl: "http://x",
      projectKey: "pk",
      origin: "http://x",
      sleep: async (ms) => {
        waits.push(ms);
      },
    }).ask(evalCase);

    expect(waits).toEqual([3000]);
    expect(answer.answer).toBe("alpha");
  });

  it("gives up with an actionable message rather than retrying forever", async () => {
    vi.stubGlobal("fetch", async () => limited(2));

    await expect(
      createHttpTarget({
        apiUrl: "http://x",
        projectKey: "pk",
        origin: "http://x",
        maxRetries: 2,
        sleep: async () => {},
      }).ask(evalCase),
    ).rejects.toThrow(/DESKBELL_RATE_LIMIT_ASK_PER_MIN/);
  });

  it("refuses to idle for a retry window longer than the cap", async () => {
    // A 30-minute Retry-After should fail fast with advice, not hang a run.
    vi.stubGlobal("fetch", async () => limited(1800));

    await expect(
      createHttpTarget({
        apiUrl: "http://x",
        projectKey: "pk",
        origin: "http://x",
        sleep: async () => {},
      }).ask(evalCase),
    ).rejects.toThrow(/1800s/);
  });

  it("surfaces a non-429 failure with the server's own detail", async () => {
    vi.stubGlobal("fetch", async () => new Response("origin not allowed", { status: 403 }));

    await expect(
      createHttpTarget({ apiUrl: "http://x", projectKey: "pk", origin: "http://evil" }).ask(
        evalCase,
      ),
    ).rejects.toThrow(/403.*origin not allowed/s);
  });
});
