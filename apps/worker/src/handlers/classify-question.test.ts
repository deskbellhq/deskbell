import { describe, expect, it } from "vitest";
import { type ClassifyDeps, classifyQuestion } from "./classify-question";

type Loaded = Awaited<ReturnType<ClassifyDeps["loadQuestion"]>>;

function fake(
  opts: {
    loaded?: Loaded;
    limit?: number;
    used?: number;
    reply?: { topic: string | null; intent: "how_to" | "other"; signals: Array<"pushback"> };
  } = {},
) {
  const saved: Array<[string, unknown]> = [];
  const usage: Array<{ input: number; output: number }> = [];
  const inputs: Array<{
    question: string;
    previous?: string;
    product?: string;
    other: string;
    topics: number;
  }> = [];
  const deps: ClassifyDeps = {
    async loadQuestion() {
      return opts.loaded === undefined
        ? {
            question: "and for CSV?",
            previous: "How do I export a feed?",
            product: "Acme",
            topics: [{ key: "exports", name: "Exports", description: "" }],
          }
        : opts.loaded;
    },
    async budget() {
      return { limit: opts.limit ?? 0, usedToday: opts.used ?? 0 };
    },
    classifier: {
      modelId: "test/model",
      async classify(input, o) {
        inputs.push({
          question: input.question,
          previous: input.previous,
          product: input.product,
          other: input.other,
          topics: input.topics.length,
        });
        o?.onUsage?.({ input: 80, output: 12 });
        return opts.reply ?? { topic: "exports", intent: "how_to", signals: ["pushback"] };
      },
    },
    async save(id, labels) {
      saved.push([id, labels]);
    },
    async recordUsage(u) {
      usage.push(u);
    },
  };
  return { deps, saved, usage, inputs };
}

describe("classifyQuestion", () => {
  it("labels, saves all three fields and records usage, passing the previous turn and the bucket", async () => {
    const f = fake();
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("labelled");
    expect(f.saved).toEqual([
      ["msg_1", { topic: "exports", intent: "how_to", signals: ["pushback"] }],
    ]);
    expect(f.usage).toEqual([{ input: 80, output: 12 }]);
    expect(f.inputs[0]).toEqual({
      question: "and for CSV?",
      previous: "How do I export a feed?",
      product: "Acme",
      other: "other",
      topics: 1,
    });
  });

  it("labels a question on a project without topics, with a null topic", async () => {
    const f = fake({
      loaded: { question: "Can I talk to someone?", product: "Acme", topics: [] },
      reply: { topic: null, intent: "other", signals: [] },
    });
    expect(await classifyQuestion(f.deps, "msg_2")).toBe("labelled");
    expect(f.inputs[0]?.topics).toBe(0);
    expect(f.saved).toEqual([["msg_2", { topic: null, intent: "other", signals: [] }]]);
  });

  it("does nothing for a missing or labelled question", async () => {
    const f = fake({ loaded: null });
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("missing");
    expect(f.saved).toEqual([]);
    expect(f.usage).toEqual([]);
  });

  it("does nothing when the project has labelling switched off", async () => {
    const f = fake({ loaded: "off" });
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("off");
    expect(f.inputs).toEqual([]);
    expect(f.saved).toEqual([]);
  });

  it("stops at the daily budget without calling the model", async () => {
    const f = fake({ limit: 100, used: 100 });
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("budget");
    expect(f.inputs).toEqual([]);
    expect(f.saved).toEqual([]);
  });

  it("records usage even when saving fails", async () => {
    const f = fake();
    f.deps.save = async () => {
      throw new Error("db down");
    };
    await expect(classifyQuestion(f.deps, "msg_1")).rejects.toThrow("db down");
    expect(f.usage).toEqual([{ input: 80, output: 12 }]);
  });
});
