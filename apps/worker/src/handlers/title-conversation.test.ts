import { describe, expect, it } from "vitest";
import { type TitleDeps, titleConversation } from "./title-conversation";

function fake(
  opts: {
    exchange?: { question: string; answer?: string } | null;
    limit?: number;
    used?: number;
    reply?: string;
  } = {},
) {
  const saved: string[] = [];
  const usage: Array<{ input: number; output: number }> = [];
  let calls = 0;
  const deps: TitleDeps = {
    async loadExchange() {
      return opts.exchange === undefined ? { question: "How do I export a feed?" } : opts.exchange;
    },
    async budget() {
      return { limit: opts.limit ?? 0, usedToday: opts.used ?? 0 };
    },
    titler: {
      modelId: "test/model",
      async title(_input, o) {
        calls += 1;
        o?.onUsage?.({ input: 40, output: 6 });
        return opts.reply ?? "Exporting a feed";
      },
    },
    async save(_id, title) {
      saved.push(title);
    },
    async recordUsage(u) {
      usage.push(u);
    },
  };
  return { deps, saved, usage, calls: () => calls };
}

describe("titleConversation", () => {
  it("titles, saves and records usage", async () => {
    const f = fake();
    expect(await titleConversation(f.deps, "conv_1")).toBe("titled");
    expect(f.saved).toEqual(["Exporting a feed"]);
    expect(f.usage).toEqual([{ input: 40, output: 6 }]);
  });

  it("does nothing for a missing or renamed conversation", async () => {
    const f = fake({ exchange: null });
    expect(await titleConversation(f.deps, "conv_1")).toBe("missing");
    expect(f.calls()).toBe(0);
  });

  it("refuses when the daily budget is spent, without a model call", async () => {
    const f = fake({ limit: 100, used: 100 });
    expect(await titleConversation(f.deps, "conv_1")).toBe("budget");
    expect(f.calls()).toBe(0);
    expect(f.saved).toEqual([]);
  });

  it("keeps the creation title when the model wrote nothing usable, still charging usage", async () => {
    const f = fake({ reply: "" });
    expect(await titleConversation(f.deps, "conv_1")).toBe("skipped");
    expect(f.saved).toEqual([]);
    expect(f.usage).toHaveLength(1);
  });
});
