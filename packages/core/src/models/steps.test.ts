import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { EngineTool, GenerationPart } from "../engine";
import { createEngineModelDeps } from "./index";

/**
 * The step budget of a turn with tools (spec: mcp-actions). What is pinned:
 * when the last allowed step ends in a tool call, the turn still produces
 * an answer — one more generation, with no tools — and when a step writes
 * the answer itself, nothing extra is spent.
 */

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Part = Parameters<typeof simulateReadableStream>[0]["chunks"][number];

const stream = (chunks: Part[]) => ({ stream: simulateReadableStream({ chunks }) });

const callStep = () =>
  stream([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ id: "1" }) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
  ]);

const textStep = (text: string) =>
  stream([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ]);

const lookup: EngineTool = {
  name: "lookup",
  title: "Lookup",
  description: "Looks an order up",
  inputSchema: { type: "object", properties: { id: { type: "string" } } },
  policy: "allow",
  readOnly: true,
  execute: async () => "order 1 shipped",
};

async function run(model: MockLanguageModelV4, maxSteps: number) {
  const deps = createEngineModelDeps(
    {
      DESKBELL_CHAT_MODEL: "openai/gpt-5-mini",
      DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      DESKBELL_ACTION_MAX_STEPS: String(maxSteps),
    },
    {},
    undefined,
    { chat: model },
  );
  const parts: GenerationPart[] = [];
  let usage: { input: number; output: number } | undefined;
  for await (const raw of deps.generate({
    system: "Answer from the context.",
    context: "(no documents matched)",
    message: "Where is order 1?",
    tools: [lookup],
    onUsage: (u) => {
      usage = u;
    },
  })) {
    parts.push(typeof raw === "string" ? { type: "text", value: raw } : raw);
  }
  const text = parts
    .filter((p): p is { type: "text"; value: string } => p.type === "text")
    .map((p) => p.value)
    .join("");
  return { parts, text, usage };
}

describe("createEngineModelDeps — the step budget", () => {
  it("writes the answer in one more generation when the last step went to a tool", async () => {
    const model = new MockLanguageModelV4({
      doStream: [callStep(), textStep("Order 1 has shipped.")],
    });
    const { parts, text, usage } = await run(model, 1);
    expect(parts.find((p) => p.type === "tool-result")).toMatchObject({
      tool: "lookup",
      output: "order 1 shipped",
    });
    expect(text).toBe("Order 1 has shipped.");
    expect(model.doStreamCalls).toHaveLength(2);
    // The closing generation carries no tools and no tool parts, only the
    // results as text and the instruction to answer.
    const closing = model.doStreamCalls[1];
    expect(closing?.tools ?? []).toHaveLength(0);
    const roles = closing?.prompt.map((m) => m.role);
    expect(roles).not.toContain("tool");
    const last = closing?.prompt.at(-1);
    const content = JSON.stringify(last?.content);
    expect(content).toContain("order 1 shipped");
    expect(content).toContain("No further tool call");
    // Both generations are billed.
    expect(usage).toEqual({ input: 20, output: 10 });
  });

  it("spends nothing extra when a step writes the answer itself", async () => {
    const model = new MockLanguageModelV4({ doStream: [callStep(), textStep("Shipped.")] });
    const { text, usage } = await run(model, 2);
    expect(text).toBe("Shipped.");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(usage).toEqual({ input: 20, output: 10 });
  });
});
