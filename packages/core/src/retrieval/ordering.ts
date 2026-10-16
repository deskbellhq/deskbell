import type { ScoredChunk } from "./vector-store";

/**
 * Final-ordering policies over a pooled candidate set (spec: hybrid-retrieval
 * §4). Pure functions so the choice is unit-testable and a harness sweep can
 * flip it per run.
 *
 * "fused" is the shipped default: best fused rank first, ties resolved toward
 * the canonical variant, then cosine, then chunkId. The lexical leg exists to
 * surface exact-token matches — error codes, config keys, identifiers — that
 * sit at middling cosine to the question; re-sorting the pool by cosine would
 * re-bury exactly those hits, so "cosine" is the sweep alternative rather
 * than the default.
 */
export type CandidateOrder = "fused" | "cosine";

export function orderCandidates(candidates: ScoredChunk[], order: CandidateOrder): ScoredChunk[] {
  const byCosine = (a: ScoredChunk, b: ScoredChunk) => {
    // Nulls last: "no embedding yet" must never outrank a scored chunk here —
    // its chance to rank is its fused position, not a fake similarity.
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  };
  const sorted = [...candidates];
  if (order === "fused") {
    sorted.sort(
      (a, b) =>
        (a.fused?.rank ?? Number.POSITIVE_INFINITY) - (b.fused?.rank ?? Number.POSITIVE_INFINITY) ||
        (a.fused?.variant ?? Number.POSITIVE_INFINITY) -
          (b.fused?.variant ?? Number.POSITIVE_INFINITY) ||
        byCosine(a, b) ||
        a.chunkId.localeCompare(b.chunkId),
    );
  } else {
    sorted.sort(
      (a, b) =>
        byCosine(a, b) ||
        (a.fused?.rank ?? Number.POSITIVE_INFINITY) - (b.fused?.rank ?? Number.POSITIVE_INFINITY) ||
        a.chunkId.localeCompare(b.chunkId),
    );
  }
  return sorted;
}

/**
 * Keep at most `max` chunks per document, preserving order; 0 = off.
 *
 * Applied at FINAL selection, never per leg or per variant: per-leg it would
 * prune the union before the scoring pass, and per-variant it caps nothing
 * once the variants pool. Exists because top-k over chunks hands a long
 * document one slot per chunk while a short canonical page gets exactly one
 * shot (spec: hybrid-retrieval, open questions).
 */
export function capPerDocument(candidates: ScoredChunk[], max: number): ScoredChunk[] {
  if (max <= 0) return candidates;
  const seen = new Map<string, number>();
  return candidates.filter((c) => {
    const n = seen.get(c.documentId) ?? 0;
    if (n >= max) return false;
    seen.set(c.documentId, n + 1);
    return true;
  });
}
