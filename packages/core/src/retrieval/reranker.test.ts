import { describe, expect, it } from "vitest";
import { applyRanking } from "./reranker";
import type { ScoredChunk } from "./vector-store";

const chunk = (id: string): ScoredChunk => ({
  chunkId: id,
  documentId: `doc_${id}`,
  position: null,
  title: id,
  content: id,
  score: 0.5,
});

describe("applyRanking", () => {
  const candidates = [chunk("a"), chunk("b"), chunk("c"), chunk("d")];

  it("reorders by the given indices", () => {
    expect(applyRanking(candidates, [2, 0, 3, 1]).map((c) => c.chunkId)).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
  });

  it("appends candidates the ranking never mentioned, in incoming order", () => {
    // A partial ranking degrades to "ranked first, rest as fused" — a model
    // that ranks only what it is sure about must not silently drop the rest.
    expect(applyRanking(candidates, [2]).map((c) => c.chunkId)).toEqual(["c", "a", "b", "d"]);
  });

  it("drops out-of-range, duplicate and non-integer indices", () => {
    // Everything a structured-output model actually produces when it goes
    // wrong: hallucinated numbers, repeats, floats, negatives.
    expect(applyRanking(candidates, [7, 1, 1, -1, 0.5, 2]).map((c) => c.chunkId)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("an empty ranking is the identity", () => {
    expect(applyRanking(candidates, []).map((c) => c.chunkId)).toEqual(["a", "b", "c", "d"]);
  });
});
