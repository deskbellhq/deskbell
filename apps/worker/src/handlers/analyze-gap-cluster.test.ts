import type { GapAnalysisInput } from "@deskbell/core/models";
import type { StoredGapAnalysis } from "@deskbell/db";
import { describe, expect, it } from "vitest";
import { type AnalyzeDeps, analyzeGapCluster, BUDGET_ERROR } from "./analyze-gap-cluster";

const NOW = new Date(Date.UTC(2026, 8, 10, 12, 0));

const RESULT = {
  title: "Exporting data",
  finding: "Visitors asked how to export; the retrieved pages cover imports only.",
  recommendation: "Add an Exports page describing the CSV export and where the button is.",
  suggestedFacts: ["Exports are CSV files", "The export button is on the Data page"],
};

/**
 * The deps' contract in memory: a hash that depends only on the questions,
 * a model that either answers, fails, or must not be reached.
 */
function fake(
  opts: {
    stored?: StoredGapAnalysis | null;
    limit?: number;
    used?: number;
    model?: "ok" | "fail" | "forbidden";
    questions?: string[];
    unsupportedTerms?: string[];
  } = {},
) {
  const log: string[] = [];
  const saved: StoredGapAnalysis[] = [];
  const errors: string[] = [];
  const usage: Array<{ input: number; output: number }> = [];
  const inputs: GapAnalysisInput[] = [];
  const deps: AnalyzeDeps = {
    async loadCluster(id) {
      return id === "gap_1"
        ? { id, label: "How do I export?", analysis: opts.stored ?? null }
        : null;
    },
    async loadQuestions() {
      return opts.questions ?? ["How do I export?", "Exporting — how?"];
    },
    async loadEvidence() {
      return [{ title: "Imports", url: "https://docs.test/imports", snippet: "Imports are…" }];
    },
    async loadSignals() {
      const unsupportedTerms = opts.unsupportedTerms ?? [];
      return {
        refused: true,
        downvoted: false,
        weak: false,
        unsupported: unsupportedTerms.length > 0,
        unsupportedTerms,
      };
    },
    async budget() {
      return { limit: opts.limit ?? 0, usedToday: opts.used ?? 0 };
    },
    analyst: {
      modelId: "test/model",
      inputHash: (input) => `h(${[...input.questions].sort().join("|")})`,
      async analyze(input, o) {
        log.push("analyze");
        inputs.push(input);
        if (opts.model === "forbidden") throw new Error("model must not be reached");
        if (opts.model === "fail") throw new Error("provider exploded");
        o?.onUsage?.({ input: 120, output: 80 });
        return RESULT;
      },
    },
    async save(_id, analysis) {
      saved.push(analysis);
    },
    async saveError(_id, error) {
      errors.push(error);
    },
    async clearPending() {
      log.push("clearPending");
    },
    async recordUsage(u) {
      usage.push(u);
    },
  };
  return { deps, log, saved, errors, usage, inputs };
}

describe("analyzeGapCluster", () => {
  it("hands the analyst the names the answers could not support, only when there are any", async () => {
    const plain = fake();
    await analyzeGapCluster(plain.deps, "gap_1", NOW);
    expect(plain.inputs[0]?.signals).toEqual({ refused: true, downvoted: false, weak: false });
    expect(plain.inputs[0]).not.toHaveProperty("unsupportedTerms");

    const named = fake({ unsupportedTerms: ["Find and Replace"] });
    await analyzeGapCluster(named.deps, "gap_1", NOW);
    expect(named.inputs[0]?.signals.unsupported).toBe(true);
    expect(named.inputs[0]?.unsupportedTerms).toEqual(["Find and Replace"]);
  });

  it("analyses, stores the result with provenance, and records usage", async () => {
    const { deps, saved, usage } = fake();
    expect(await analyzeGapCluster(deps, "gap_1", NOW)).toBe("analyzed");
    expect(saved[0]).toEqual({
      ...RESULT,
      model: "test/model",
      analyzedAt: NOW.toISOString(),
      inputHash: "h(Exporting — how?|How do I export?)",
    });
    expect(usage).toEqual([{ input: 120, output: 80 }]);
  });

  it("skips unchanged material without reaching the model, and clears the pending mark", async () => {
    const stored: StoredGapAnalysis = {
      ...RESULT,
      model: "test/model",
      analyzedAt: "2026-09-01T00:00:00.000Z",
      inputHash: "h(Exporting — how?|How do I export?)",
    };
    const { deps, log, usage } = fake({ stored, model: "forbidden" });
    expect(await analyzeGapCluster(deps, "gap_1", NOW)).toBe("unchanged");
    expect(log).toEqual(["clearPending"]);
    expect(usage).toEqual([]);
  });

  it("re-analyses when a new phrasing joined since", async () => {
    const stored: StoredGapAnalysis = {
      ...RESULT,
      model: "test/model",
      analyzedAt: "2026-09-01T00:00:00.000Z",
      inputHash: "h(How do I export?)",
    };
    const { deps, saved } = fake({ stored });
    expect(await analyzeGapCluster(deps, "gap_1", NOW)).toBe("analyzed");
    expect(saved).toHaveLength(1);
  });

  it("refuses on a spent budget with a stored error and no model call", async () => {
    const { deps, errors, usage } = fake({ limit: 1000, used: 1000, model: "forbidden" });
    expect(await analyzeGapCluster(deps, "gap_1", NOW)).toBe("budget");
    expect(errors).toEqual([BUDGET_ERROR]);
    expect(usage).toEqual([]);
  });

  it("treats budget 0 as unlimited", async () => {
    const { deps } = fake({ limit: 0, used: 999_999 });
    expect(await analyzeGapCluster(deps, "gap_1", NOW)).toBe("analyzed");
  });

  it("stores the error and rethrows when the model fails", async () => {
    const { deps, errors, saved } = fake({ model: "fail" });
    await expect(analyzeGapCluster(deps, "gap_1", NOW)).rejects.toThrow("provider exploded");
    expect(errors).toEqual(["provider exploded"]);
    expect(saved).toEqual([]);
  });

  it("reports a cluster it cannot see", async () => {
    const { deps } = fake();
    expect(await analyzeGapCluster(deps, "gap_other", NOW)).toBe("missing");
  });
});
