import type { ScoredChunk } from "./vector-store";

/**
 * The rerank seam (spec: hybrid-retrieval §4).
 *
 * This module is types and pure helpers only. Drivers reach a model, so they
 * live in `src/models` — the one module allowed to import a provider SDK
 * (D4, D13) — and are injected through `EngineDeps.rerank`, exactly like the
 * query planner.
 *
 * The default is NO reranker: absent, ordering is whatever fusion produced.
 * A reranker is always in-process or remote — it must NEVER become a service
 * in docker-compose (D11: Postgres is the only infra dependency; a
 * model-serving sidecar is the one quality lever that bar deliberately rules
 * out as a default, and the spec says so out loud rather than pretending the
 * no-op default is equivalent).
 */

export interface RerankInput {
  /**
   * The canonical question. Candidates are judged against it and never
   * against a variant: one scoring query across the pool is what makes the
   * resulting order comparable at all.
   */
  question: string;
  /** Pooled candidates in fused order. */
  candidates: ScoredChunk[];
  /** Token accounting, same contract as generate/embed. */
  onUsage?: (usage: { input: number; output: number }) => void;
}

export interface RerankResult {
  /**
   * Indices into the input candidates, best first. The ORDER is the output
   * (§5 — the array order is the ranking); indices that are out of range,
   * duplicated, or missing are repaired by applyRanking, so a noisy ranking
   * degrades instead of throwing.
   */
  order: number[];
  /**
   * Optional relevance scores parallel to `order`, on the driver's own
   * scale. A separate scale from cosine `score`; nothing thresholds it by
   * default — a rerank-stage relevance floor is the only control that can
   * turn an answer into a refusal, correct documents routinely score low,
   * and calibrating that trade needs real traffic, so it ships OFF.
   */
  scores?: number[];
}

/**
 * Implementations must be allowed to reject — the ENGINE owns the fallback
 * (keep fusion order, skip any floor that would need the missing scores, log
 * loudly). A reranker outage costs quality, never availability.
 */
export type Reranker = (input: RerankInput) => Promise<RerankResult>;

/**
 * Hard cap on candidates any driver scores. The engine's pool default sits
 * well below it; the cap exists so a misconfigured pool cannot turn one
 * rerank call into an unbounded prompt or an unbounded batch of forward
 * passes. Shared by every driver so "how much a reranker can be asked to do"
 * has one answer.
 */
export const MAX_RERANK_CANDIDATES = 50;

/**
 * Reorder candidates by a ranking that cannot be trusted: out-of-range and
 * duplicate indices are dropped, and candidates the ranking never mentioned
 * are appended in their incoming (fused) order. Pure, so the degradation
 * rules are unit-tested rather than hoped for.
 */
export function applyRanking(candidates: ScoredChunk[], order: number[]): ScoredChunk[] {
  const seen = new Set<number>();
  const ranked: ScoredChunk[] = [];
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    ranked.push(candidates[index] as ScoredChunk);
  }
  for (let i = 0; i < candidates.length; i++) {
    if (!seen.has(i)) ranked.push(candidates[i] as ScoredChunk);
  }
  return ranked;
}
