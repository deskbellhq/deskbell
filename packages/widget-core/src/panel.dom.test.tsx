import { DeskbellError } from "@deskbell/sdk";
import type { AnswerEvent, WidgetConversation, WidgetMessage } from "@deskbell/shared";
import { resolveWidgetConfig, type WidgetConfig } from "@deskbell/shared/widget-config";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel } from "./panel.tsx";

/**
 * The panel against a fake SDK client (spec: widget-browser-tests). The
 * transport is the SDK's business; here every method is a spy so a test can
 * script the server's side of a conversation.
 */
const fake = {
  ask: vi.fn(),
  list: vi.fn(),
  messages: vi.fn(),
  delete: vi.fn(),
  preview: vi.fn(),
  feedback: vi.fn(),
  ping: vi.fn(),
};

vi.mock("@deskbell/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@deskbell/sdk")>();
  class DeskbellClient {
    conversations = {
      list: (...a: unknown[]) => fake.list(...a),
      messages: (...a: unknown[]) => fake.messages(...a),
      delete: (...a: unknown[]) => fake.delete(...a),
      rename: vi.fn(),
      preview: (...a: unknown[]) => fake.preview(...a),
    };
    ask(...a: unknown[]) {
      return fake.ask(...a);
    }
    feedback(...a: unknown[]) {
      return fake.feedback(...a);
    }
    ping() {
      return fake.ping();
    }
    config() {
      return Promise.resolve({});
    }
  }
  return { ...actual, DeskbellClient };
});

async function* stream(events: AnswerEvent[]) {
  for (const e of events) yield e;
}

const answer = (text: string, extra: AnswerEvent[] = []): AnswerEvent[] => [
  { type: "token", value: text },
  ...extra,
  { type: "done", conversationId: "conv_1", messageId: "msg_1" },
];

function mount(overrides: Partial<WidgetConfig> = {}, slots?: Set<string>) {
  const host = document.createElement("div");
  document.body.append(host);
  const config = resolveWidgetConfig({ projectKey: "pk", apiUrl: "", ...overrides });
  const events: CustomEvent[] = [];
  host.addEventListener("deskbell:limited", (e) => events.push(e as CustomEvent));
  render(<Panel config={config} cssVars="" host={host} slots={slots} />, { container: host });
  return { host, events };
}

const sendQuestion = async (text: string) => {
  const input = await screen.findByRole("textbox", { name: "Ask a question…" });
  fireEvent.input(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
};

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset();
  fake.ping.mockResolvedValue(undefined);
  fake.list.mockResolvedValue([]);
  fake.feedback.mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("floating", () => {
  it("opens from the launcher and closes on Escape", async () => {
    mount();
    expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open help" }));
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull());
  });
});

describe("inline", () => {
  it("has no launcher, stays open on Escape, and shows a header only when slotted", async () => {
    const { host } = mount({ mode: "inline" });
    expect(screen.queryByRole("button", { name: "Open help" })).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(host.querySelector('[part="header"]')).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Help" })).toBeTruthy();
    document.body.innerHTML = "";
    const slotted = mount({ mode: "inline" }, new Set(["header"]));
    expect(slotted.host.querySelector('[part="header"]')).not.toBeNull();
  });
});

describe("asking", () => {
  it("streams Markdown into the bubble and renders citation pills by kind", async () => {
    fake.ask.mockImplementation(() =>
      stream(
        answer("Hello **there**", [
          {
            type: "citations",
            citations: [
              {
                documentId: "d1",
                title: "Guide",
                url: "https://d.test/g",
                snippet: "…",
                kind: "docs-crawler",
              },
            ],
          },
        ]),
      ),
    );
    const { host } = mount({ mode: "inline" });
    await sendQuestion("hi");
    await screen.findByText("there", { selector: "strong" });
    const pill = host.querySelector('[part~="citation-kind-docs-crawler"]');
    expect(pill?.textContent).toBe("Guide");
    expect(pill?.getAttribute("href")).toBe("https://d.test/g");
  });

  it("labels a written answer's pill with a glyph and a second line", async () => {
    fake.ask.mockImplementation(() =>
      stream(
        answer("Open Billing.", [
          {
            type: "citations",
            citations: [
              { documentId: "h", title: "How do I cancel?", snippet: "…", kind: "corrections" },
              { documentId: "p", title: "Pricing", url: "https://d.test/p", snippet: "…" },
            ],
          },
        ]),
      ),
    );
    const { host } = mount({ mode: "inline" });
    await sendQuestion("cancel?");
    await screen.findByText("Open Billing.");
    const written = host.querySelector('[part~="citation-kind-corrections"]');
    expect(written?.tagName).toBe("SPAN");
    expect(written?.querySelector("svg")).not.toBeNull();
    expect(written?.querySelector('[part="citation-label"]')?.textContent).toBe("Written answer");
    const page = host.querySelector('[href="https://d.test/p"]');
    expect(page?.textContent).toBe("Pricing");
    expect(page?.querySelector("svg")).toBeNull();
  });

  it("renders a clarifying question as options, and a tap asks the option", async () => {
    fake.ask
      .mockImplementationOnce(() =>
        stream([
          {
            type: "clarify",
            question: "Configure what?",
            options: ["Theming the widget", "Installing Deskbell"],
          },
          { type: "done", conversationId: "conv_1", messageId: "msg_1" },
        ]),
      )
      .mockImplementationOnce(() => stream(answer("Set the custom properties.")));
    const { host } = mount({ mode: "inline" });
    const heard: CustomEvent[] = [];
    host.addEventListener("deskbell:clarify", (e) => heard.push(e as CustomEvent));
    await sendQuestion("how do I configure it?");
    const option = await screen.findByRole("button", { name: "Theming the widget" });
    expect(host.querySelectorAll('[part="clarify-option"]')).toHaveLength(2);
    expect(heard[0]?.detail).toEqual({
      question: "how do I configure it?",
      asked: "Configure what?",
      options: ["Theming the widget", "Installing Deskbell"],
    });
    // Enabled once the stream has closed; a tap mid-stream would be lost.
    await waitFor(() => expect((option as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(option);
    await screen.findByText("Set the custom properties.");
    expect(fake.ask).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Theming the widget", conversationId: "conv_1" }),
      expect.anything(),
    );
    // The options belong to the latest message only.
    expect(host.querySelector('[part="clarify-option"]')).toBeNull();
  });

  it("shows the limited copy and emits deskbell:limited on a 429", async () => {
    fake.ask.mockImplementation(() => {
      throw new DeskbellError(429, undefined, 7);
    });
    const { events } = mount({ mode: "inline" });
    await sendQuestion("hi");
    await screen.findByText("That was a lot of questions — give it a moment and try again.");
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toMatchObject({ question: "hi", retryAfter: 7 });
  });
});

describe("own-data fallback (spec: own-data-fallback)", () => {
  it("speaks a refusal that carries text as an answer, and still tells the host", async () => {
    fake.ask.mockImplementation(() =>
      stream([
        { type: "refusal", reason: "no_access", text: "I can't see your **account** from here." },
        { type: "done", conversationId: "conv_1", messageId: "msg_1" },
      ]),
    );
    const { host } = mount({ mode: "inline" });
    const heard: CustomEvent[] = [];
    host.addEventListener("deskbell:refusal", (e) => heard.push(e as CustomEvent));
    await sendQuestion("why is my score low?");
    const bubble = (await screen.findByText(/from here\./)).closest(".bubble") as HTMLElement;
    expect(bubble.classList.contains("md")).toBe(true);
    expect(bubble.querySelector("strong")?.textContent).toBe("account");
    expect(bubble.closest(".msg")?.classList.contains("refused")).toBe(false);
    expect(heard[0]?.detail).toMatchObject({ reason: "no_access" });
  });

  it("replays a refused row with content as an answer, and one without as the refusal copy", async () => {
    fake.messages.mockResolvedValue([
      {
        id: "m1",
        role: "assistant",
        content: "I can't see your account from here.",
        citations: [],
        refused: true,
        feedback: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "m2",
        role: "assistant",
        content: "",
        citations: [],
        refused: true,
        feedback: null,
        createdAt: new Date().toISOString(),
      },
    ] satisfies WidgetMessage[]);
    localStorage.setItem("deskbell-last-conv:pk", "conv_9");
    const { host } = mount({ mode: "inline", resumeThread: "last" });
    await screen.findByText("I couldn't find an answer to that in the docs.");
    const spoken = screen.getByText("I can't see your account from here.").closest(".msg");
    expect(spoken?.classList.contains("refused")).toBe(false);
    expect(host.querySelectorAll(".msg.refused")).toHaveLength(1);
  });
});

describe("answer verification (spec: answer-verification)", () => {
  const hedgeOf = (host: HTMLElement) =>
    waitFor(() => {
      const el = host.querySelector('[part="hedge"]');
      if (!el) throw new Error("no hedge yet");
      return el;
    });

  it("speaks the names the documentation lacks under the answer, and tells the host", async () => {
    fake.ask.mockImplementationOnce(() =>
      stream(
        answer("Use **Find and Replace** or **Merge**.", [
          { type: "citations", citations: [] },
          { type: "verification", unsupportedTerms: ["Find and Replace", "Merge"] },
        ]),
      ),
    );
    const { host } = mount({ mode: "inline" });
    const heard: CustomEvent[] = [];
    host.addEventListener("deskbell:answer", (e) => heard.push(e as CustomEvent));
    await sendQuestion("which box?");
    const hedge = await hedgeOf(host);
    expect(hedge.textContent).toBe(
      "I couldn't find Find and Replace and Merge in the documentation, so that part may not be accurate.",
    );
    expect([...hedge.querySelectorAll("strong")].map((el) => el.textContent)).toEqual([
      "Find and Replace",
      "Merge",
    ]);
    // Inside the bubble: spoken, not badged.
    expect(hedge.closest('[part="bubble"]')).not.toBeNull();
    expect(heard[0]?.detail.unsupportedTerms).toEqual(["Find and Replace", "Merge"]);
  });

  it("honours the operator's wording, and renders nothing when the answer is clean", async () => {
    fake.ask.mockImplementationOnce(() =>
      stream(answer("Fine.", [{ type: "verification", unsupportedTerms: ["Made Up"] }])),
    );
    const { host } = mount({
      mode: "inline",
      copy: { unsupportedNote: "Not in our docs: {terms}." },
    });
    const heard: CustomEvent[] = [];
    host.addEventListener("deskbell:answer", (e) => heard.push(e as CustomEvent));
    await sendQuestion("q");
    expect((await hedgeOf(host)).textContent).toBe("Not in our docs: Made Up.");

    fake.ask.mockImplementationOnce(() => stream(answer("Also fine.")));
    await sendQuestion("q2");
    await screen.findByText("Also fine.");
    expect(host.querySelectorAll('[part="hedge"]')).toHaveLength(1);
    expect(heard[1]?.detail).not.toHaveProperty("unsupportedTerms");
  });

  it("replays the hedge from a stored message", async () => {
    fake.messages.mockResolvedValue([
      {
        id: "m1",
        role: "user",
        content: "which box?",
        citations: null,
        refused: false,
        feedback: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "m2",
        role: "assistant",
        content: "Use **Merge**.",
        citations: [],
        refused: false,
        feedback: null,
        unsupportedTerms: ["Merge"],
        createdAt: new Date().toISOString(),
      },
    ]);
    localStorage.setItem("deskbell-last-conv:pk", "conv_9");
    const { host } = mount({ mode: "inline", resumeThread: "last" });
    expect((await hedgeOf(host)).textContent).toContain("Merge");
  });
});

describe("configured feedback reasons", () => {
  it("offers text only for a reason with a note, gates send, then thanks", async () => {
    fake.ask.mockImplementation(() => stream(answer("An answer.")));
    mount({
      mode: "inline",
      feedbackReasons: [
        { id: "incorrect", label: "Incorrect" },
        { id: "other", label: "Other", note: 300 },
      ],
    });
    await sendQuestion("hi");
    const down = await screen.findByRole("button", { name: "Not helpful" });
    fireEvent.click(down);
    const card = (await screen.findByText("What went wrong?")).closest(".reason") as HTMLElement;
    const send = within(card).getByRole("button", { name: "Send" });
    expect(send).toHaveProperty("disabled", true);
    expect(within(card).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Other" }));
    expect(within(card).getByRole("textbox")).toBeTruthy();
    expect(send).toHaveProperty("disabled", false);
    fireEvent.click(send);
    await screen.findByText("Thanks for the feedback.");
    expect(fake.feedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: "msg_1", feedback: "down", reason: "other" }),
    );
  });
});

describe("sidebar", () => {
  const rows: WidgetConversation[] = [
    { id: "c1", title: "Export settings", snippet: "…", lastMessageAt: new Date().toISOString() },
    { id: "c2", title: "Billing", snippet: "…", lastMessageAt: new Date().toISOString() },
  ];

  it("lists threads, asks before deleting, removes optimistically", async () => {
    fake.list.mockResolvedValue(rows);
    fake.delete.mockResolvedValue(undefined);
    mount({ mode: "inline", historyLayout: "sidebar", resumeThread: "none" });
    const aside = await screen.findByRole("complementary", { name: "Conversations" });
    await within(aside).findByRole("button", { name: /^Export settings/ });
    fireEvent.click(within(aside).getByRole("button", { name: "Delete: Export settings" }));
    await within(aside).findByText("Delete this conversation?");
    fireEvent.click(within(aside).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(within(aside).queryByRole("button", { name: /^Export settings/ })).toBeNull(),
    );
    expect(fake.delete).toHaveBeenCalledWith("c1");
  });

  it("re-reads the list when the host hands over a token after the first paint", async () => {
    fake.list.mockResolvedValue([]);
    const host = document.createElement("div");
    document.body.append(host);
    const config = resolveWidgetConfig({
      projectKey: "pk",
      apiUrl: "",
      mode: "inline",
      historyLayout: "sidebar",
      resumeThread: "none",
    });
    const { rerender } = render(<Panel config={config} cssVars="" host={host} />, {
      container: host,
    });
    const aside = await screen.findByRole("complementary", { name: "Conversations" });
    await within(aside).findByText("No conversations yet.");
    const before = fake.list.mock.calls.length;
    fake.list.mockResolvedValue(rows);
    rerender(<Panel config={config} cssVars="" host={host} getAuthToken={() => "t"} />);
    await within(aside).findByRole("button", { name: /^Billing/ });
    expect(fake.list.mock.calls.length).toBe(before + 1);
  });

  it("puts the row back when the server fails", async () => {
    fake.list.mockResolvedValue(rows);
    fake.delete.mockRejectedValue(new DeskbellError(500));
    mount({ mode: "inline", historyLayout: "sidebar", resumeThread: "none" });
    const aside = await screen.findByRole("complementary", { name: "Conversations" });
    await within(aside).findByRole("button", { name: /^Billing/ });
    fireEvent.click(within(aside).getByRole("button", { name: "Delete: Billing" }));
    fireEvent.click(await within(aside).findByRole("button", { name: "Delete" }));
    await within(aside).findByRole("button", { name: /^Billing/ });
  });
});

describe("readonly", () => {
  const transcript: WidgetMessage[] = [
    {
      id: "m1",
      role: "user",
      content: "How?",
      citations: null,
      refused: false,
      feedback: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: "m2",
      role: "assistant",
      content: "Like this.",
      citations: null,
      refused: false,
      feedback: "up",
      createdAt: new Date().toISOString(),
    },
  ];

  it("shows the transcript with no composer and disabled thumbs", async () => {
    fake.preview.mockResolvedValue({
      conversation: { id: "c9", title: "How?", context: null, createdAt: new Date().toISOString() },
      endUser: { name: "Ada", email: "a@b.test" },
      messages: transcript,
    });
    mount({ readonly: true, conversationId: "c9" });
    await screen.findByText("Like this.");
    expect(screen.queryByRole("textbox", { name: "Ask a question…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveProperty("disabled", true);
    expect(fake.preview).toHaveBeenCalledWith("c9");
  });

  it("explains a 403", async () => {
    fake.preview.mockRejectedValue(new DeskbellError(403));
    mount({ readonly: true, conversationId: "c9" });
    await screen.findByText("You don't have access to this conversation.");
  });
});

describe("actions (spec: mcp-actions, action-presentation)", () => {
  it("shows a step line above the answer, keeps the tool out of Sources, and emits deskbell:action", async () => {
    fake.ask.mockImplementation(() =>
      stream([
        { type: "action", id: "act_1", title: "Look up your order", status: "running" },
        { type: "action", id: "act_1", title: "Look up your order", status: "succeeded" },
        ...answer("Shipped yesterday.", [
          {
            type: "citations",
            citations: [
              {
                documentId: "action:act_1",
                title: "Look up your order",
                snippet: "…",
                kind: "action",
              },
            ],
          },
        ]),
      ]),
    );
    const { host } = mount({ mode: "inline" });
    const seen: string[] = [];
    host.addEventListener("deskbell:action", (e) => seen.push((e as CustomEvent).detail.status));
    await sendQuestion("where is my order?");
    await screen.findByText("Shipped yesterday.");
    const msg = host.querySelectorAll('[part="message"]')[1];
    const step = msg?.querySelector('[part="action"]');
    expect(step?.classList.contains("succeeded")).toBe(true);
    expect(step?.querySelector('[part="action-title"]')?.textContent).toBe("Look up your order");
    // The check mark says it; the word stays for assistive tech only.
    const status = step?.querySelector('[part="action-status"]');
    expect(status?.textContent).toBe("Done");
    expect(status?.classList.contains("sr-only")).toBe(true);
    // Steps come before the answer, folded, and a tool run is not a source.
    expect(msg?.firstElementChild?.getAttribute("part")).toBe("activity");
    expect(msg?.firstElementChild?.querySelector('[part="actions"]')).not.toBeNull();
    expect(host.querySelector('[part="citations"]')).toBeNull();
    expect(host.querySelector('[part~="citation-kind-action"]')).toBeNull();
    expect(seen).toEqual(["running", "succeeded"]);
  });

  it("folds the steps once the answer starts and says how long it worked (spec: activity-disclosure)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    fake.ask.mockImplementation(async function* () {
      yield { type: "action", id: "act_1", title: "Look up your order", status: "running" };
      yield { type: "action", id: "act_1", title: "Look up your order", status: "succeeded" };
      yield { type: "action", id: "act_2", title: "Check the carrier", status: "running" };
      await gate;
      yield { type: "action", id: "act_2", title: "Check the carrier", status: "succeeded" };
      yield* answer("Shipped yesterday.");
    });
    const { host } = mount({ mode: "inline" });
    await sendQuestion("where is my order?");
    await screen.findByText("Check the carrier…");
    const group = host.querySelector('[part="activity"]') as HTMLDetailsElement;
    // Open while the model works, with a busy summary and the lines live inside.
    expect(group.open).toBe(true);
    expect(group.querySelector('[part="activity-summary"]')?.textContent).toBe("Thinking…");
    expect(group.querySelectorAll('[part="action"]')).toHaveLength(2);
    release();
    await screen.findByText("Shipped yesterday.");
    // Folded once the answer started; the summary counts the steps and the wait.
    expect(group.open).toBe(false);
    const summary = group.querySelector('[part="activity-summary"]')?.textContent ?? "";
    expect(summary).toMatch(/^Worked for \d+s · 2 steps$/);
    expect(group.querySelectorAll('[part="action"]')).toHaveLength(2);
  });

  it("shows reasoning as blocks between the step lines, in order, and never as a source", async () => {
    fake.ask.mockImplementation(() =>
      stream([
        { type: "reasoning", value: "The visitor asks about " },
        { type: "reasoning", value: "an order. I will look it up." },
        { type: "action", id: "act_1", title: "Look up your order", status: "running" },
        { type: "action", id: "act_1", title: "Look up your order", status: "succeeded" },
        { type: "reasoning", value: "It shipped; answer plainly." },
        ...answer("Shipped yesterday."),
      ]),
    );
    const { host } = mount({ mode: "inline" });
    await sendQuestion("where is my order?");
    await screen.findByText("Shipped yesterday.");
    const group = host.querySelector('[part="activity"]');
    const parts = Array.from(group?.querySelector(".activity-body")?.children ?? []).map((el) =>
      el.getAttribute("part"),
    );
    expect(parts).toEqual(["reasoning", "actions", "reasoning"]);
    const blocks = group?.querySelectorAll('[part="reasoning"]');
    expect(blocks?.[0]?.textContent).toBe("The visitor asks about an order. I will look it up.");
    expect(blocks?.[1]?.textContent).toBe("It shipped; answer plainly.");
    expect(group?.querySelector('[part="activity-summary"]')?.textContent).toMatch(
      /^Worked for \d+s · 1 step$/,
    );
    expect(host.querySelector('[part="citations"]')).toBeNull();
  });

  it("hides the typing dots while reasoning streams, and shows a fold with no steps", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    fake.ask.mockImplementation(async function* () {
      yield { type: "reasoning", value: "Thinking about the docs." };
      await gate;
      yield* answer("Here is the answer.");
    });
    const { host } = mount({ mode: "inline" });
    await sendQuestion("how do I reset my password?");
    await screen.findByText("Thinking about the docs.");
    expect(host.querySelector('[part="typing"]')).toBeNull();
    release();
    await screen.findByText("Here is the answer.");
    const summary = host.querySelector('[part="activity-summary"]')?.textContent ?? "";
    expect(summary).toMatch(/^Worked for \d+s$/);
    expect(host.querySelector('[part="actions"]')).toBeNull();
  });

  it("renders no fold on a plain answer", async () => {
    fake.ask.mockImplementation(() => stream(answer("Just an answer.")));
    const { host } = mount({ mode: "inline" });
    await sendQuestion("hello?");
    await screen.findByText("Just an answer.");
    expect(host.querySelector('[part="activity"]')).toBeNull();
  });

  it("shows no typing dots while a step is running, and again once it finished", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    fake.ask.mockImplementation(async function* () {
      yield { type: "action", id: "act_1", title: "Look up your order", status: "running" };
      await gate;
      yield { type: "action", id: "act_1", title: "Look up your order", status: "failed" };
      await new Promise((r) => setTimeout(r, 20));
      yield* answer("I couldn't reach the order system.");
    });
    const { host } = mount({ mode: "inline" });
    await sendQuestion("where is my order?");
    await screen.findByText("Look up your order…");
    // The spinner on the step line is the busy signal; no second one.
    expect(host.querySelector('[part="typing"]')).toBeNull();
    expect(
      host.querySelectorAll('[part="message"]')[1]?.querySelector('[part="bubble"]'),
    ).toBeNull();
    release();
    // Tool done, answer not yet started: the model is writing, dots are back.
    await waitFor(() => expect(host.querySelector('[part="typing"]')).not.toBeNull());
    await screen.findByText("I couldn't reach the order system.");
    const step = host.querySelector('[part="action"]');
    expect(step?.querySelector('[part="action-title"]')?.textContent).toBe("Look up your order");
    const status = step?.querySelector('[part="action-status"]');
    expect(status?.textContent).toBe("Couldn't complete");
    expect(status?.classList.contains("sr-only")).toBe(false);
  });

  it("renders a confirmation card with the arguments as a list, sends the decision, and keeps the verdict", async () => {
    fake.ask
      .mockImplementationOnce(() =>
        stream([
          {
            type: "confirm",
            id: "act_2",
            title: "Cancel your order",
            summary: "Cancel your order — id: 42",
            details: [{ label: "Order ID", value: "42" }],
            input: { id: "42" },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          { type: "done", conversationId: "conv_1", messageId: "msg_1" },
        ]),
      )
      .mockImplementationOnce(() =>
        stream([
          { type: "action", id: "act_2", title: "Cancel your order", status: "succeeded" },
          ...answer("Cancelled."),
        ]),
      );
    const { host } = mount({ mode: "inline" });
    const decisions: unknown[] = [];
    host.addEventListener("deskbell:confirm", (e) => decisions.push((e as CustomEvent).detail));
    await sendQuestion("cancel order 42");
    await screen.findByText("Confirm to continue");
    const card = host.querySelector('[part="action-card"]');
    expect(card?.querySelector('[part="action-title"]')?.textContent).toBe("Cancel your order");
    expect(card?.querySelector("dt")?.textContent).toBe("Order ID");
    expect(card?.querySelector("dd")?.textContent).toBe("42");
    // No argument name and no empty bubble on a turn that only asked.
    expect(host.textContent).not.toContain("id: 42");
    const asking = host.querySelectorAll('[part="message"]')[1];
    expect(asking?.querySelector('[part="bubble"]')).toBeNull();
    expect(asking?.querySelector('[part="feedback"]')).toBeNull();
    // The buttons wake once the paused turn's stream has closed.
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.click(confirm);
    await screen.findByText("Cancelled.");
    expect(fake.ask.mock.calls[1]?.[0]).toMatchObject({
      message: "",
      conversationId: "conv_1",
      approval: { callId: "act_2", approved: true },
    });
    // The card became a step line on the message it belongs to, and the
    // call's run is recorded there too — not again under the answer.
    expect(host.querySelector('[part="action-card"]')).toBeNull();
    const steps = host.querySelectorAll('[part="action"]');
    expect(steps).toHaveLength(1);
    expect(asking?.contains(steps[0] ?? null)).toBe(true);
    expect(steps[0]?.classList.contains("succeeded")).toBe(true);
    expect(steps[0]?.querySelector('[part="action-buttons"]')).toBeNull();
    expect(decisions).toEqual([
      {
        id: "act_2",
        title: "Cancel your order",
        summary: "Cancel your order — id: 42",
        details: [{ label: "Order ID", value: "42" }],
      },
      { id: "act_2", approved: true, conversationId: "conv_1" },
    ]);
  });

  it("shows a declined card as a cancelled step", async () => {
    fake.ask
      .mockImplementationOnce(() =>
        stream([
          {
            type: "confirm",
            id: "act_4",
            title: "Cancel your order",
            summary: "Cancel your order — id: 9",
            details: [{ label: "Order ID", value: "9" }],
            input: { id: "9" },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          { type: "done", conversationId: "conv_1", messageId: "msg_1" },
        ]),
      )
      .mockImplementationOnce(() => stream(answer("Okay, I left it as it is.")));
    const { host } = mount({ mode: "inline" });
    await sendQuestion("cancel order 9");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveProperty("disabled", false));
    fireEvent.click(cancel);
    await screen.findByText("Okay, I left it as it is.");
    const step = host.querySelector('[part="action"]');
    expect(step?.classList.contains("denied")).toBe(true);
    expect(step?.querySelector('[part="action-status"]')?.textContent).toBe("Cancelled");
  });

  it("replays a pending card from history, falls back to the summary, and offers no buttons once it expired", async () => {
    fake.list.mockResolvedValue({ conversations: [] });
    const history: WidgetMessage[] = [
      {
        id: "m1",
        role: "user",
        content: "cancel it",
        citations: null,
        refused: false,
        feedback: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "m2",
        role: "assistant",
        content: "",
        citations: null,
        refused: false,
        feedback: null,
        actions: [
          {
            id: "act_3",
            title: "Cancel order",
            status: "pending_approval",
            summary: "Cancel order — id: 7",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          {
            id: "act_5",
            title: "Cancel order",
            status: "pending_approval",
            summary: "Cancel order — id: 8",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
      },
    ];
    fake.messages.mockResolvedValue(history);
    localStorage.setItem("deskbell-last-conv:pk", "conv_9");
    const { host } = mount({ mode: "inline", resumeThread: "last" });
    await screen.findByText("Confirm to continue");
    const card = host.querySelector('[part="action-card"]');
    // A call stored before details existed shows the summary minus the title.
    expect(card?.querySelector(".action-summary")?.textContent).toBe("id: 7");
    expect(card?.querySelector('[part="action-buttons"]')).not.toBeNull();
    const expired = host.querySelector('[part="action"].expired, [part="action"].pending_approval');
    expect(expired?.querySelector('[part="action-status"]')?.textContent).toBe("Expired");
    expect(expired?.querySelector('[part="action-buttons"]')).toBeNull();
    // A replayed message has no timing, so the fold counts its steps only, and starts closed.
    const group = host.querySelector('[part="activity"]') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.querySelector('[part="activity-summary"]')?.textContent).toBe("1 step");
  });
});

describe("labels a host can turn on (spec: answer-rendering-fixes)", () => {
  it("counts the sources in the label and shows the feedback prompt", async () => {
    fake.ask.mockReturnValue(
      stream(
        answer("Yes.", [
          {
            type: "citations",
            citations: [
              { documentId: "d1", url: "https://d.test/1", title: "One", snippet: "" },
              { documentId: "d2", url: "https://d.test/2", title: "Two", snippet: "" },
            ],
          },
        ]),
      ),
    );
    const { host } = mount({
      mode: "inline",
      feedback: true,
      copy: { sources: "Sources · {n}", feedbackPrompt: "Was this answer helpful?" },
    } as Partial<WidgetConfig>);
    await sendQuestion("does it?");
    await screen.findByText("Yes.");
    expect(host.querySelector('[part="citations-label"]')?.textContent).toBe("Sources · 2");
    await waitFor(() => expect(host.querySelector('[part="feedback"]')).not.toBeNull());
    expect(host.querySelector('[part="feedback-label"]')?.textContent).toBe(
      "Was this answer helpful?",
    );
  });

  it("names the thread rail in a title part", async () => {
    fake.list.mockResolvedValue([]);
    const { host } = mount({ mode: "inline", conversationHistory: true, historyLayout: "sidebar" });
    await waitFor(() => expect(host.querySelector('[part="sidebar-title"]')).not.toBeNull());
    expect(host.querySelector('[part="sidebar-head"]')).not.toBeNull();
  });
});
