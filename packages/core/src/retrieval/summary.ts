/**
 * The retrieval evidence an answer rested on, in three numbers (spec:
 * answer-signal). Shared by the ask path, which persists them per message,
 * and the eval harness, which records them per case — one definition so the
 * threshold measured on the harness means the same thing in production.
 */
export interface RetrievalSummary {
  /** Chunks retrieval returned after the per-document cap and limit. */
  hits: number;
  /** Highest cosine among the scored chunks; null when none carried a score. */
  topScore: number | null;
  /** Mean over the scored chunks; null under the same rule. */
  meanScore: number | null;
}

/**
 * Max, not first: the array order is the ranking, and a fused or reranked
 * ranking is not sorted by cosine. Unscored chunks (a lexical-only hit with no
 * embedding yet) are left out of both numbers rather than counted as zero.
 */
export function summarizeRetrieval(
  chunks: ReadonlyArray<{ score: number | null }>,
): RetrievalSummary {
  const scores = chunks.map((c) => c.score).filter((s): s is number => s !== null);
  if (scores.length === 0) return { hits: chunks.length, topScore: null, meanScore: null };
  const topScore = Math.max(...scores);
  const meanScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return { hits: chunks.length, topScore, meanScore };
}
