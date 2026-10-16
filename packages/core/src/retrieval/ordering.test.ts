import { describe, expect, it } from "vitest";
import { capPerDocument, orderCandidates } from "./ordering";
import type { ScoredChunk } from "./vector-store";

function chunk(
  id: string,
  score: number | null,
  fused?: { rank: number; variant?: number; legs?: Array<"vector" | "lexical"> },
): ScoredChunk {
  return {
    chunkId: id,
    documentId: `doc_${id}`,
    position: null,
    title: id,
    content: id,
    score,
    ...(fused
      ? {
          fused: {
            score: 1 / (60 + fused.rank),
            rank: fused.rank,
            variant: fused.variant ?? 0,
            legs: fused.legs ?? ["vector"],
          },
        }
      : {}),
  };
}

describe("orderCandidates", () => {
  it("fused order puts the best fused rank first, regardless of cosine", () => {
    // The exact-token case the lexical leg exists for: a lexical winner at
    // middling cosine must not be re-buried under fluent high-cosine text.
    const lexicalWinner = chunk("lex", 0.31, { rank: 1, legs: ["lexical"] });
    const fluent = chunk("vec", 0.82, { rank: 2 });
    expect(orderCandidates([fluent, lexicalWinner], "fused").map((c) => c.chunkId)).toEqual([
      "lex",
      "vec",
    ]);
    // The sweep alternative re-sorts by cosine — that is the whole difference.
    expect(orderCandidates([fluent, lexicalWinner], "cosine").map((c) => c.chunkId)).toEqual([
      "vec",
      "lex",
    ]);
  });

  it("resolves fused-rank ties toward the canonical variant", () => {
    const fromVariant = chunk("b", 0.9, { rank: 1, variant: 2 });
    const fromCanonical = chunk("a", 0.5, { rank: 1, variant: 0 });
    expect(orderCandidates([fromVariant, fromCanonical], "fused").map((c) => c.chunkId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("sorts null scores last under cosine order — no embedding is not similarity 0", () => {
    const unembedded = chunk("null", null, { rank: 1 });
    const low = chunk("low", 0.01, { rank: 2 });
    expect(orderCandidates([unembedded, low], "cosine").map((c) => c.chunkId)).toEqual([
      "low",
      "null",
    ]);
  });

  it("leaves candidates without fused info in their given (driver) order", () => {
    const first = chunk("a", 0.7);
    const second = chunk("b", 0.9);
    // No fused ranks: fused order falls through to cosine, then id — but a
    // plain vector result arrives pre-sorted by cosine, so nothing moves.
    expect(orderCandidates([second, first], "fused").map((c) => c.chunkId)).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [chunk("b", 0.1, { rank: 2 }), chunk("a", 0.9, { rank: 1 })];
    const copy = [...input];
    orderCandidates(input, "fused");
    expect(input).toEqual(copy);
  });
});

describe("capPerDocument", () => {
  const doc = (id: string, documentId: string): ScoredChunk => ({
    ...chunk(id, 0.5),
    documentId,
  });

  it("keeps at most max chunks per document, preserving order", () => {
    const input = [doc("a1", "A"), doc("a2", "A"), doc("b1", "B"), doc("a3", "A")];
    expect(capPerDocument(input, 2).map((c) => c.chunkId)).toEqual(["a1", "a2", "b1"]);
  });

  it("0 means off — the cap is ranking-affecting and defaults that way", () => {
    const input = [doc("a1", "A"), doc("a2", "A"), doc("a3", "A")];
    expect(capPerDocument(input, 0)).toBe(input);
  });
});
