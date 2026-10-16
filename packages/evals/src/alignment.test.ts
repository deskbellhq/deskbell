import { describe, expect, it } from "vitest";
import { parseHumanGrades, scoreAlignment } from "./alignment";
import type { EvalCaseResult, Grade } from "./types";

const result = (id: string, grade: Grade | null): EvalCaseResult => ({
  id,
  kind: "answerable",
  question: "q",
  refused: false,
  grade,
  score: null,
  reason: "",
  matchedFacts: [],
  missingFacts: [],
  factCoverage: null,
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
});

describe("scoreAlignment", () => {
  it("reports exact and binary agreement separately", () => {
    // They differ exactly where the A/B boundary does — the subjective one a
    // judge cannot fairly be held to.
    const alignment = scoreAlignment([result("a", "A"), result("b", "B"), result("c", "C")], {
      a: "A",
      b: "A",
      c: "C",
    });
    expect(alignment?.labelled).toBe(3);
    expect(alignment?.exactAgreement).toBeCloseTo(2 / 3);
    expect(alignment?.binaryAgreement).toBeCloseTo(2 / 3);
  });

  it("names the disagreements, so a low number can be read without a rerun", () => {
    const alignment = scoreAlignment([result("a", "C")], { a: "A" });
    expect(alignment?.disagreements).toEqual({ a: "A → C" });
  });

  it("scores only the cases a human actually labelled", () => {
    // Treating an unlabelled case as agreement would let a half-finished label
    // file report a flattering number.
    const alignment = scoreAlignment([result("a", "A"), result("b", "C")], { a: "A" });
    expect(alignment?.labelled).toBe(1);
    expect(alignment?.exactAgreement).toBe(1);
  });

  it("returns null when nothing overlaps", () => {
    expect(scoreAlignment([result("a", "A")], { other: "A" })).toBeNull();
  });

  it("rejects a label file with a grade outside the scale", () => {
    expect(() => parseHumanGrades('{"a":"D"}')).toThrow();
  });
});
