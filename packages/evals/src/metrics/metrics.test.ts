import { describe, expect, it } from "vitest";
import type { EvalCaseResult, RetrievedChunk } from "../types";
import { scoreCitations } from "./citations";
import { rankedDocuments, scoreRetrieval } from "./retrieval";
import { factuality, falseRefusalRate, groundedness, percentile, uncertainty } from "./scores";

const hit = (documentId: string, chunkId = `${documentId}#0`): RetrievedChunk => ({
  chunkId,
  documentId,
  score: 0.5,
});

describe("scoreRetrieval", () => {
  it("returns null when the case declares no relevant documents", () => {
    // Unlabelled cases must not silently count as zero — that would drag the
    // average down in proportion to how little labelling had been done.
    expect(scoreRetrieval([hit("a")], [], 8)).toBeNull();
  });

  it("scores a perfect hit at rank one", () => {
    const s = scoreRetrieval([hit("a"), hit("b")], ["a"], 8);
    // precision@k is 0.5: two documents came back and one of them was wanted.
    expect(s).toEqual({ recallAtK: 1, precisionAtK: 0.5, mrr: 1, ndcgAtK: 1 });
  });

  it("halves MRR when the relevant document is second", () => {
    const s = scoreRetrieval([hit("b"), hit("a")], ["a"], 8);
    expect(s?.recallAtK).toBe(1);
    expect(s?.mrr).toBe(0.5);
  });

  it("collapses several chunks of one document to its best rank", () => {
    // Three chunks of the same document are one retrieved document, ranked
    // where the best of them landed — otherwise a chunky document looks like
    // better retrieval than it is.
    const s = scoreRetrieval([hit("a", "a#0"), hit("a", "a#1"), hit("b")], ["a", "b"], 8);
    expect(s?.recallAtK).toBe(1);
    expect(s?.mrr).toBe(1);
  });

  it("counts only the top k, so a deeper list cannot flatter recall", () => {
    const s = scoreRetrieval([hit("x"), hit("y"), hit("a")], ["a"], 2);
    expect(s?.recallAtK).toBe(0);
    expect(s?.mrr).toBe(0);
  });

  it("scores nothing found as zero rather than as null", () => {
    expect(scoreRetrieval([hit("x")], ["a"], 8)).toEqual({
      recallAtK: 0,
      precisionAtK: 0,
      mrr: 0,
      ndcgAtK: 0,
    });
  });

  it("scores an EMPTY result as zero, so a starved query cannot leave the average", () => {
    // The bug this pins: skipping cases where retrieval returned nothing lets a
    // change that starves the hardest questions raise recall by shrinking the
    // denominator. Empty is a result; only "the target cannot see" is unknown.
    expect(scoreRetrieval([], ["a"], 8)).toEqual({
      recallAtK: 0,
      precisionAtK: 0,
      mrr: 0,
      ndcgAtK: 0,
    });
  });

  it("measures precision over documents returned, not over k", () => {
    // Three chunks of one wanted document and one chunk of another are two
    // documents in front of the reader, not four.
    const s = scoreRetrieval(
      [hit("a", "a#0"), hit("a", "a#1"), hit("a", "a#2"), hit("b")],
      ["a"],
      8,
    );
    expect(s?.precisionAtK).toBe(0.5);
  });
});

describe("rankedDocuments", () => {
  it("collapses chunks to documents at the best rank each reached", () => {
    // The report row and the metrics share this collapse, so a document with
    // three chunks in the top k is one retrieved document in both places.
    const docs = rankedDocuments([hit("a", "a#0"), hit("b"), hit("a", "a#1"), hit("c")], 8);
    expect(docs).toEqual(["a", "b", "c"]);
  });

  it("looks no deeper than k chunks", () => {
    expect(rankedDocuments([hit("x"), hit("y"), hit("a")], 2)).toEqual(["x", "y"]);
  });
});

describe("scoreCitations", () => {
  it("returns null without labels", () => {
    expect(scoreCitations(["a"], [])).toBeNull();
  });

  it("penalises citing more documents than support the answer", () => {
    // This is the metric that exposes citing every retrieved chunk: recall is
    // perfect and precision falls away as depth grows.
    const s = scoreCitations(["a", "b", "c", "d"], ["a"]);
    expect(s).toEqual({ precision: 0.25, recall: 1 });
  });

  it("ignores duplicate citations of the same document", () => {
    expect(scoreCitations(["a", "a", "b"], ["a"])).toEqual({ precision: 0.5, recall: 1 });
  });

  it("scores zero precision when nothing was cited", () => {
    expect(scoreCitations([], ["a"])).toEqual({ precision: 0, recall: 0 });
  });
});

const result = (over: Partial<EvalCaseResult>): EvalCaseResult => ({
  id: "c",
  kind: "answerable",
  question: "q",
  refused: false,
  grade: "A",
  score: 1,
  reason: "",
  matchedFacts: [],
  missingFacts: [],
  factCoverage: 1,
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
  ...over,
});

describe("aggregate scores", () => {
  it("averages fact coverage, not grades, into factuality", () => {
    // Coverage, so a case missing one criterion of six and one missing one of
    // two do not both land on the same half-step.
    expect(
      factuality([
        result({ factCoverage: 1 }),
        result({ factCoverage: 0.5 }),
        result({ factCoverage: 0 }),
      ]),
    ).toBe(0.5);
  });

  it("is unmoved by the letter grade, which is only the per-case outcome", () => {
    // Two cases with the same B and very different coverage must not report the
    // same factuality — that collapse is what the ordinal mean was doing.
    const shallow = factuality([result({ grade: "B", score: 0.5, factCoverage: 1 / 6 })]);
    const deep = factuality([result({ grade: "B", score: 0.5, factCoverage: 5 / 6 })]);
    expect(shallow).not.toBe(deep);
  });

  it("counts a refused answerable case as zero, not as absent", () => {
    // Refusing everything would otherwise show as perfect factuality over an
    // empty set — the single most flattering bug this metric could have.
    expect(
      factuality([result({ factCoverage: 1 }), result({ factCoverage: 0, refused: true })]),
    ).toBe(0.5);
  });

  it("returns null for factuality when nothing is answerable", () => {
    expect(factuality([result({ kind: "unanswerable", correctRefusal: true })])).toBeNull();
  });

  it("scores uncertainty over unanswerable cases only", () => {
    const cases = [
      result({ kind: "unanswerable", correctRefusal: true }),
      result({ kind: "unanswerable", correctRefusal: false }),
      result({ score: 1 }),
    ];
    expect(uncertainty(cases)).toBe(0.5);
  });

  it("reports false refusals separately from factuality", () => {
    const cases = [result({ falseRefusal: true, score: 0 }), result({ score: 1 })];
    expect(falseRefusalRate(cases)).toBe(0.5);
  });

  it("leaves groundedness null when no case was assessed", () => {
    expect(groundedness([result({ grounded: null })])).toBeNull();
  });

  it("scores groundedness only over assessed cases", () => {
    expect(
      groundedness([result({ grounded: true }), result({ grounded: false }), result({})]),
    ).toBe(0.5);
  });
});

describe("percentile", () => {
  it("returns a value that actually occurred, never an interpolation", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });

  it("handles a single sample and an empty one", () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});
