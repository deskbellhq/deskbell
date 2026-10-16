import type { AnswerEvent } from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import {
  type ActionReport,
  type AskInput,
  createEngine,
  type EngineDeps,
  type EngineTool,
  type GenerationPart,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_WITH_TOOLS,
  TOOLS_PROMPT,
} from "./engine";
import type { ScoredChunk } from "./retrieval/vector-store";

/**
 * The engine with tools (spec: mcp-actions): what a scripted model layer
 * yields becomes status events, confirmation cards, citations and reports,
 * and the holds behave across a tool call.
 */

const chunk = (id: string, content = "some grounding text"): ScoredChunk => ({
  chunkId: id,
  documentId: `doc_${id}`,
  title: `Title ${id}`,
  position: null,
  content,
  score: 0.9,
});

const lookup: EngineTool = {
  name: "shop__order_status",
  title: "Order status",
  description: "Looks up an order",
  inputSchema: { type: "object", properties: { id: { type: "string" } } },
  policy: "allow",
  readOnly: true,
  execute: async () => ({ status: "shipped" }),
};

const cancel: EngineTool = {
  ...lookup,
  name: "shop__cancel",
  title: "Cancel order",
  policy: "confirm",
};

interface Seen {
  system?: string;
  context?: string;
  tools?: EngineTool[];
  resume?: unknown;
}

function deps(
  hits: ScoredChunk[],
  script: Array<string | GenerationPart>,
  seen: Seen = {},
): EngineDeps {
  return {
    vectorStore: {
      id: "fake",
      async search() {
        return hits;
      },
      async upsert() {},
      async deleteByDocument() {},
    },
    async embed() {
      return { embedding: [0.1], tokens: 1 };
    },
    async *generate({ system, context, tools, resume, onUsage }) {
      seen.system = system;
      seen.context = context;
      seen.tools = tools;
      seen.resume = resume;
      for (const part of script) yield part;
      onUsage?.({ input: 10, output: 2 });
    },
  };
}

const base: Omit<AskInput, "message"> = {
  orgId: "org_1",
  projectId: "proj_1",
  conversationId: "conv_1",
};

async function run(
  hits: ScoredChunk[],
  script: Array<string | GenerationPart>,
  input: Partial<AskInput> = {},
  seen: Seen = {},
): Promise<{ events: AnswerEvent[]; reports: ActionReport[] }> {
  const reports: ActionReport[] = [];
  const engine = createEngine(deps(hits, script, seen));
  const events: AnswerEvent[] = [];
  for await (const e of engine.ask({
    ...base,
    message: "where is my order 42?",
    tools: [lookup, cancel],
    onAction: (r) => reports.push(r),
    ...input,
  })) {
    events.push(e);
  }
  return { events, reports };
}

const text = (events: AnswerEvent[]) =>
  events
    .filter((e): e is Extract<AnswerEvent, { type: "token" }> => e.type === "token")
    .map((e) => e.value)
    .join("");

const call: GenerationPart = {
  type: "tool-call",
  callId: "c1",
  tool: "shop__order_status",
  input: { id: "42" },
};
const result: GenerationPart = {
  type: "tool-result",
  callId: "c1",
  tool: "shop__order_status",
  output: { status: "shipped" },
};

describe("createEngine — tools (spec: mcp-actions)", () => {
  it("extends the prompt only when tools are present", async () => {
    const seen: Seen = {};
    await run([chunk("c1")], ["Fine.\nSOURCES: 1"], {}, seen);
    expect(seen.system).toBe(SYSTEM_PROMPT_WITH_TOOLS + TOOLS_PROMPT);
    expect(SYSTEM_PROMPT_WITH_TOOLS).toContain("call a listed tool that could");
    expect(SYSTEM_PROMPT_WITH_TOOLS).toContain("NO_GROUNDING");
    expect(seen.tools?.map((t) => t.name)).toEqual(["shop__order_status", "shop__cancel"]);

    const plain: Seen = {};
    await run([chunk("c1")], ["Fine.\nSOURCES: 1"], { tools: [] }, plain);
    expect(plain.system).toBe(SYSTEM_PROMPT);
    expect(plain.tools).toBeUndefined();
  });

  it("asks the model even when retrieval returned nothing", async () => {
    const seen: Seen = {};
    const { events } = await run([], [call, result, "Shipped.\nSOURCES: T1"], {}, seen);
    expect(seen.context).toBe("(no documents matched)");
    expect(events.some((e) => e.type === "refusal")).toBe(false);
    expect(text(events)).toBe("Shipped.");
  });

  it("still refuses on an empty retrieval when there are no tools", async () => {
    const { events } = await run([], ["ignored"], { tools: [] });
    expect(events).toEqual([{ type: "refusal", reason: "no_context" }]);
  });

  it("emits a status event per call, and reports the call to the host", async () => {
    const { events, reports } = await run([chunk("c1")], [call, result, "Shipped.\nSOURCES: T1"]);
    expect(events.filter((e) => e.type === "action")).toEqual([
      { type: "action", id: "c1", title: "Order status", status: "running" },
      { type: "action", id: "c1", title: "Order status", status: "succeeded" },
    ]);
    expect(reports[0]).toMatchObject({
      type: "call",
      callId: "c1",
      title: "Order status",
      input: { id: "42" },
    });
    expect(reports[1]).toMatchObject({
      type: "result",
      callId: "c1",
      output: { status: "shipped" },
    });
  });

  it("cites a named tool result as an action, and nothing else", async () => {
    const { events } = await run([chunk("c1")], [call, result, "Shipped.\nSOURCES: T1"]);
    const citations = events.find((e) => e.type === "citations");
    expect(citations).toEqual({
      type: "citations",
      citations: [
        {
          documentId: "action:c1",
          title: "Order status",
          snippet: '{"status":"shipped"}',
          kind: "action",
        },
      ],
    });
  });

  it("cites blocks and tool results side by side", async () => {
    const { events } = await run(
      [chunk("c1"), chunk("c2")],
      [call, result, "Both.\nSOURCES: 2, T1"],
    );
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations.map((c) => c.documentId)).toEqual(
      ["doc_c2", "action:c1"],
    );
  });

  it("falls back to every retrieved block plus every result when nothing is named", async () => {
    const { events } = await run([chunk("c1")], [call, result, "Shipped."]);
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations.map((c) => c.documentId)).toEqual(
      ["doc_c1", "action:c1"],
    );
  });

  it("a failed call is reported, marked failed, and never cited", async () => {
    const failed: GenerationPart = { ...result, output: null, error: "timeout" };
    const { events } = await run([chunk("c1")], [call, failed, "Could not check.\nSOURCES: 1"]);
    expect(events.filter((e) => e.type === "action").at(-1)).toMatchObject({ status: "failed" });
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations.map((c) => c.kind)).toEqual([
      undefined,
    ]);
  });

  it("withdraws a refusal the model started before calling a tool", async () => {
    const { events } = await run(
      [chunk("c1")],
      ["NO_GROUND", call, result, "Shipped.\nSOURCES: T1"],
    );
    expect(events.some((e) => e.type === "refusal")).toBe(false);
    expect(text(events)).toBe("Shipped.");
  });

  it("flushes held prose before a call and drops a mid-turn sources line", async () => {
    const { events } = await run(
      [chunk("c1")],
      ["Let me check.\nSOURCES: 1", call, result, "Shipped.\nSOURCES: T1"],
    );
    expect(text(events)).toBe("Let me check.Shipped.");
  });

  it("does not report a confirm tool as running: the card is what the visitor sees", async () => {
    const call: GenerationPart = {
      type: "tool-call",
      callId: "c2",
      tool: "shop__cancel",
      input: { id: "42" },
    };
    const approval: GenerationPart = {
      type: "approval",
      callId: "c2",
      approvalId: "ap_1",
      tool: "shop__cancel",
      input: { id: "42" },
    };
    const { events, reports } = await run(
      [chunk("c1")],
      [call, approval, { type: "paused", messages: [] }],
    );
    expect(events.filter((e) => e.type === "action")).toEqual([]);
    expect(reports.map((r) => r.type)).toEqual(["approval", "paused"]);
  });

  it("pauses on a confirmation: a card, then done, and the paused step reported", async () => {
    const approval: GenerationPart = {
      type: "approval",
      callId: "c2",
      approvalId: "ap_1",
      tool: "shop__cancel",
      input: { id: "42" },
    };
    const paused: GenerationPart = {
      type: "paused",
      messages: [{ role: "assistant", content: [] }],
    };
    const { events, reports } = await run([chunk("c1")], [approval, paused]);
    expect(events).toEqual([
      {
        type: "confirm",
        id: "c2",
        title: "Cancel order",
        summary: "Cancel order — id: 42",
        details: [{ label: "ID", value: "42" }],
        input: { id: "42" },
      },
      { type: "done", conversationId: "conv_1", messageId: "" },
    ]);
    expect(reports).toEqual([
      {
        type: "approval",
        callId: "c2",
        approvalId: "ap_1",
        tool: "shop__cancel",
        title: "Cancel order",
        input: { id: "42" },
        details: [{ label: "ID", value: "42" }],
      },
      { type: "paused", messages: [{ role: "assistant", content: [] }] },
    ]);
  });

  describe("with verification on (spec: answer-verification)", () => {
    type Report = Parameters<NonNullable<AskInput["onVerification"]>>[0];
    const verified = async (
      hits: ScoredChunk[],
      script: Array<string | GenerationPart>,
      input: Partial<AskInput> = {},
      corpus?: (terms: string[]) => Promise<Set<string>>,
    ) => {
      const reports: Report[] = [];
      const looked: string[][] = [];
      const d = deps(hits, script);
      if (corpus) {
        d.lookupTerms = async (_o, _p, terms) => {
          looked.push(terms);
          return corpus(terms);
        };
      }
      const engine = createEngine(d, { verify: true });
      const events: AnswerEvent[] = [];
      for await (const e of engine.ask({
        ...base,
        message: "where is my order 42?",
        tools: [lookup, cancel],
        onVerification: (r) => reports.push(r),
        ...input,
      })) {
        events.push(e);
      }
      return { events, reports, looked };
    };

    it("counts a tool result as support for a name", async () => {
      const shipped: GenerationPart = { ...result, output: { status: "shipped via Fast Lane" } };
      const { reports, events } = await verified(
        [chunk("c1")],
        [call, shipped, "Sent with **Fast Lane**.\nSOURCES: T1"],
      );
      expect(reports).toEqual([{ checked: ["Fast Lane"], unsupported: [] }]);
      expect(events.some((e) => e.type === "verification")).toBe(false);
    });

    it("checks nothing on a turn paused for confirmation", async () => {
      const approval: GenerationPart = {
        type: "approval",
        callId: "c2",
        approvalId: "ap_1",
        tool: "shop__cancel",
        input: { id: "42" },
      };
      const { reports, events } = await verified(
        [chunk("c1")],
        ["I will use **Made Up** for that.", approval, { type: "paused", messages: [] }],
      );
      expect(reports).toEqual([]);
      expect(events.map((e) => e.type)).toEqual(["token", "confirm", "done"]);
    });

    it("checks a resumed turn through the corpus alone, and not at all without one", async () => {
      const resume = {
        messages: [{ role: "assistant" }],
        approval: { approvalId: "ap_1", approved: true },
      };
      const script: Array<string | GenerationPart> = [
        { ...result, callId: "c2", tool: "shop__cancel", output: { ok: true } },
        "Cancelled via **Made Up**.\nSOURCES: T1",
      ];
      const withCorpus = await verified(
        [chunk("c1")],
        script,
        { message: "", resume },
        async () => new Set(),
      );
      expect(withCorpus.looked).toEqual([["Made Up"]]);
      expect(withCorpus.reports[0]?.unsupported).toEqual(["Made Up"]);

      const without = await verified([chunk("c1")], script, { message: "", resume });
      expect(without.reports).toEqual([]);
      expect(without.events.some((e) => e.type === "verification")).toBe(false);
    });
  });

  it("a resumed turn skips retrieval and hands the model the stored step", async () => {
    const seen: Seen = {};
    const resume = {
      messages: [{ role: "assistant" }],
      approval: { approvalId: "ap_1", approved: true },
    };
    const { events } = await run(
      [chunk("c1")],
      [{ ...result, callId: "c2", tool: "shop__cancel" }, "Cancelled.\nSOURCES: T1"],
      { message: "", resume },
      seen,
    );
    expect(seen.resume).toEqual(resume);
    expect(seen.context).toBe("(no documents matched)");
    expect(text(events)).toBe("Cancelled.");
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations[0]?.documentId).toBe("action:c2");
  });
});
