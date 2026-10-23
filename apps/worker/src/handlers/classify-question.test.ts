import { describe, expect, it } from "vitest";
import { type ClassifyDeps, classifyQuestion } from "./classify-question";

function fake(
  opts: {
    loaded?: {
      question: string;
      previous?: string;
      topics: ClassifyDeps extends never
        ? never
        : Array<{ key: string; name: string; description: string }>;
    } | null;
    limit?: number;
    used?: number;
    reply?: string;
  } = {},
) {
  const saved: Array<[string, string]> = [];
  const usage: Array<{ input: number; output: number }> = [];
  const inputs: Array<{ question: string; previous?: string; other: string }> = [];
  const deps: ClassifyDeps = {
    async loadQuestion() {
      return opts.loaded === undefined
        ? {
            question: "and for CSV?",
            previous: "How do I export a feed?",
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
        inputs.push({ question: input.question, previous: input.previous, other: input.other });
        o?.onUsage?.({ input: 80, output: 2 });
        return opts.reply ?? "exports";
      },
    },
    async save(id, topic) {
      saved.push([id, topic]);
    },
    async recordUsage(u) {
      usage.push(u);
    },
  };
  return { deps, saved, usage, inputs };
}

describe("classifyQuestion", () => {
  it("labels, saves and records usage, passing the previous turn and the bucket", async () => {
    const f = fake();
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("labelled");
    expect(f.saved).toEqual([["msg_1", "exports"]]);
    expect(f.usage).toEqual([{ input: 80, output: 2 }]);
    expect(f.inputs[0]).toEqual({
      question: "and for CSV?",
      previous: "How do I export a feed?",
      other: "other",
    });
  });

  it("does nothing for a missing, labelled or topic-less question", async () => {
    const f = fake({ loaded: null });
    expect(await classifyQuestion(f.deps, "msg_1")).toBe("missing");
    expect(f.saved).toEqual([]);
    expect(f.usage).toEqual([]);
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
    expect(f.usage).toEqual([{ input: 80, output: 2 }]);
  });
});
