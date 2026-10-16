import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Baseline, compareToBaseline, defaultBaselinePath, toBaseline } from "./baseline";
import type { EvalReport } from "./types";

const report = (over: Partial<EvalReport> = {}): EvalReport => ({
  dataset: "d",
  target: "t",
  judge: "deterministic",
  k: 8,
  total: 2,
  answered: 1,
  refused: 1,
  correctRefusals: 1,
  factuality: 1,
  uncertainty: 1,
  falseRefusalRate: 0,
  clarified: 0,
  clarification: null,
  clarifyRate: 0,
  groundedness: null,
  unsupportedTermRate: null,
  injectionResistance: null,
  judgeAnomalies: 0,
  tagFrequency: {},
  retrieval: { recallAtK: 1, precisionAtK: 1, mrr: 1, ndcgAtK: 1, cases: 1 },
  citations: { precision: 0.5, recall: 1, cases: 1 },
  cost: {
    inputTokens: 1,
    outputTokens: 1,
    embeddingTokens: 1,
    totalLatencyMs: 999,
    medianLatencyMs: 999,
    p95LatencyMs: 999,
  },
  cases: [],
  ...over,
});

const base = toBaseline(report());

describe("toBaseline", () => {
  it("excludes timing and tokens, which move for reasons unrelated to quality", () => {
    // A gate that trips on a slow CI runner is a gate people learn to ignore.
    expect(JSON.stringify(base)).not.toContain("999");
    expect(JSON.stringify(base)).not.toContain("Latency");
  });

  it("records each case's outcome so a swap between cases is still visible", () => {
    const b = toBaseline(
      report({
        cases: [
          {
            id: "a",
            kind: "answerable",
            question: "q",
            refused: false,
            grade: "B",
            score: 0.5,
            reason: "",
            matchedFacts: [],
            missingFacts: [],
            factCoverage: 0.5,
            judgeAnomaly: false,
            correctRefusal: null,
            falseRefusal: false,
            clarified: false,
            correctClarification: null,
            complied: null,
            grounded: null,
            citationCount: 0,
            citedDocumentIds: [],
            retrievedDocumentIds: null,
            retrievedTopScore: null,
            retrievedMeanScore: null,
            unsupportedTermCount: null,
            retrieval: null,
            citations: null,
            usage: { input: 0, output: 0, embedding: 0 },
            latencyMs: 0,
          },
        ],
      }),
    );
    expect(b.outcomes).toEqual({ a: "B" });
  });
});

describe("compareToBaseline", () => {
  it("passes an identical run", () => {
    expect(compareToBaseline(base, base).ok).toBe(true);
  });

  it("fails when a metric drops", () => {
    const worse = toBaseline(report({ factuality: 0.5 }));
    const diff = compareToBaseline(worse, base);
    expect(diff.ok).toBe(false);
    expect(diff.regressions).toEqual(["factuality: 1.0000 → 0.5000"]);
  });

  it("treats a rise in false refusals as a regression, not an improvement", () => {
    // The one metric where lower is better. Getting its direction wrong would
    // make the gate reward the failure it exists to catch.
    const worse = toBaseline(report({ falseRefusalRate: 0.4 }));
    const diff = compareToBaseline(worse, base);
    expect(diff.ok).toBe(false);
    expect(diff.regressions[0]).toContain("falseRefusalRate");
  });

  it("carries clarification numbers only when a run has something to say", () => {
    // A fixture baseline written before clarification existed must not gain
    // fields, and a set with no ambiguous cases on an engine that never asked
    // has nothing to record (spec: clarifying-questions).
    expect(base.metrics).not.toHaveProperty("clarification");
    expect(base.metrics).not.toHaveProperty("clarifyRate");
    const asked = toBaseline(report({ clarified: 1, clarifyRate: 0.5 }));
    expect(asked.metrics.clarifyRate).toBe(0.5);
    expect(asked.metrics.clarification).toBeNull();
    const diff = compareToBaseline(asked, base);
    expect(diff.ok).toBe(false);
    // Absent before, present now: reported as a metric appearing, never scored.
    expect(diff.changes).toEqual(["clarifyRate: — → 0.5000"]);
  });

  it("carries the unsupported-name rate only when a run checked something", () => {
    // A baseline written with verification off keeps its shape (spec:
    // answer-verification); the rate appearing is a change, and a rise is a
    // regression, like the clarify rate.
    expect(base.metrics).not.toHaveProperty("unsupportedTermRate");
    const checked = toBaseline(report({ unsupportedTermRate: 0.25 }));
    expect(checked.metrics.unsupportedTermRate).toBe(0.25);
    expect(compareToBaseline(checked, base).changes).toEqual(["unsupportedTermRate: — → 0.2500"]);
    const worse = toBaseline(report({ unsupportedTermRate: 0.5 }));
    const diff = compareToBaseline(worse, checked);
    expect(diff.ok).toBe(false);
    expect(diff.regressions).toEqual(["unsupportedTermRate: 0.2500 → 0.5000"]);
    expect(compareToBaseline(checked, worse).improvements).toEqual([
      "unsupportedTermRate: 0.5000 → 0.2500",
    ]);
  });

  it("treats a rise in the clarify rate as a regression, like false refusals", () => {
    const before = toBaseline(report({ clarified: 1, clarifyRate: 0.1, clarification: 1 }));
    const after = toBaseline(report({ clarified: 2, clarifyRate: 0.3, clarification: 0.5 }));
    const diff = compareToBaseline(after, before);
    expect(diff.regressions).toEqual([
      "clarification: 1.0000 → 0.5000",
      "clarifyRate: 0.1000 → 0.3000",
    ]);
  });

  it("reports an improvement without failing", () => {
    const better = toBaseline(report({ citations: { precision: 0.9, recall: 1, cases: 1 } }));
    const diff = compareToBaseline(better, base);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements[0]).toContain("citations.precision");
    expect(diff.ok).toBe(true);
  });

  it("fails on a per-case swap that leaves every average untouched", () => {
    // One case A→C and another C→A is two real changes and zero movement in
    // factuality. Averages alone would wave this through.
    const previous: Baseline = { ...base, outcomes: { a: "A", b: "C" } };
    const current: Baseline = { ...base, outcomes: { a: "C", b: "A" } };
    const diff = compareToBaseline(current, previous);
    expect(diff.ok).toBe(false);
    expect(diff.changes).toEqual(["case a: A → C", "case b: C → A"]);
  });

  it("flags a metric appearing or disappearing rather than scoring it", () => {
    const noRetrieval = toBaseline(report({ retrieval: null }));
    const diff = compareToBaseline(noRetrieval, base);
    expect(diff.ok).toBe(false);
    expect(diff.changes.some((c) => c.startsWith("retrieval.recallAtK"))).toBe(true);
  });

  it("notes a judge change, because two judges' numbers are not comparable", () => {
    const other = toBaseline(report({ judge: "llm:some-model" }));
    const diff = compareToBaseline(other, base);
    expect(diff.changes.some((c) => c.startsWith("judge changed"))).toBe(true);
  });

  it("absorbs float noise below the tolerance", () => {
    const jittered = toBaseline(report({ factuality: 1 - 0.00005 }));
    expect(compareToBaseline(jittered, base).ok).toBe(true);
  });
});

describe("defaultBaselinePath", () => {
  const datasets = fileURLToPath(new URL("../datasets", import.meta.url));
  const baselines = fileURLToPath(new URL("../baselines", import.meta.url));

  it("pairs a set in the datasets root with a baseline in the baselines root", () => {
    expect(defaultBaselinePath(join(datasets, "fixture.json"), "fixture")).toBe(
      join(baselines, "fixture.json"),
    );
  });

  it("keeps an untracked set's baseline untracked", () => {
    // The load-bearing case. `datasets/private/` and `baselines/private/` are
    // both gitignored; if this mapping ever flattens back to the baselines
    // root, a set built on a corpus we cannot republish starts committing
    // every case id and score it produced.
    expect(defaultBaselinePath(join(datasets, "private", "acme.json"), "acme")).toBe(
      join(baselines, "private", "acme.json"),
    );
  });

  it("takes the directory from the file and only the name from the dataset", () => {
    // A private set whose `name` collides with a tracked one still resolves
    // inside `private/`: the directory is what protects, not the name.
    expect(defaultBaselinePath(join(datasets, "private", "anything.json"), "fixture")).toBe(
      join(baselines, "private", "fixture.json"),
    );
  });

  it("writes beside a set that lives outside the package", () => {
    expect(defaultBaselinePath(join("/tmp", "sets", "acme.json"), "acme")).toBe(
      join("/tmp", "sets", "acme.baseline.json"),
    );
  });
});
