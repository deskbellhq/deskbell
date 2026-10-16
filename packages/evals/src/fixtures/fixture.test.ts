import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareToBaseline, serializeBaseline, toBaseline } from "../baseline";
import { parseDataset } from "../dataset";
import { createDeterministicJudge } from "../judge/deterministic";
import { runEvals } from "../run";
import { createEngineTarget } from "../target/engine";
import { buildFixture } from "./index";

const datasetPath = new URL("../../datasets/fixture.json", import.meta.url);
const baselinePath = new URL("../../baselines/fixture.json", import.meta.url);

const dataset = parseDataset(JSON.parse(readFileSync(datasetPath, "utf8")));

async function run() {
  const fixture = await buildFixture();
  return runEvals({
    dataset,
    target: createEngineTarget({
      engine: fixture.engine,
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      name: "fixture",
    }),
    judge: createDeterministicJudge(),
    k: fixture.k,
    promptHash: fixture.promptHash,
  });
}

describe("the fixture run", () => {
  it("produces an identical baseline twice", async () => {
    // The whole gate rests on this. If the fixture can disagree with itself,
    // every red build is a coin toss and the signal is worthless.
    const [first, second] = await Promise.all([run(), run()]);
    expect(serializeBaseline(toBaseline(first))).toBe(serializeBaseline(toBaseline(second)));
  });

  it("still matches the committed baseline", async () => {
    // Catches the case where the fixture corpus, the chunker or the engine
    // changed but nobody re-ran the gate.
    const committed = JSON.parse(readFileSync(baselinePath, "utf8"));
    const diff = compareToBaseline(toBaseline(await run()), committed);
    expect({ regressions: diff.regressions, changes: diff.changes }).toEqual({
      regressions: [],
      changes: [],
    });
  });

  it("is not order-dependent under concurrency", async () => {
    const [serial, parallel] = await Promise.all([run(), run()]);
    expect(toBaseline(serial).outcomes).toEqual(toBaseline(parallel).outcomes);
  });

  it("exercises both refusal paths, not just the cheap one", async () => {
    // A fixture where every unanswerable question retrieves nothing tests the
    // empty-result branch and never the grounding contract, which is the branch
    // that actually ships and the one a prompt change breaks.
    const fixture = await buildFixture();
    const target = createEngineTarget({
      engine: fixture.engine,
      orgId: fixture.orgId,
      projectId: fixture.projectId,
    });

    const unanswerable = dataset.cases.filter((c) => c.kind === "unanswerable");
    const answers = await Promise.all(unanswerable.map((c) => target.ask(c)));

    expect(answers.every((a) => a.refused)).toBe(true);
    expect(answers.some((a) => (a.retrieved ?? []).length === 0)).toBe(true);
    expect(answers.some((a) => (a.retrieved ?? []).length > 0)).toBe(true);
  });

  it("chunks the corpus with the shipped chunker into more than one chunk per document", async () => {
    // If every document collapsed to a single chunk, retrieval would be a
    // document lookup and the ranking metrics would measure nothing.
    const fixture = await buildFixture();
    const perDocument = new Map<string, number>();
    for (const chunk of fixture.chunks) {
      perDocument.set(chunk.documentId, (perDocument.get(chunk.documentId) ?? 0) + 1);
    }
    expect(perDocument.size).toBeGreaterThan(1);
    expect(Math.max(...perDocument.values())).toBeGreaterThan(1);
  });
});
