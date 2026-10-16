/**
 * The query plan: what retrieval actually searches for, and what everything is
 * scored against (spec: grounded-generation).
 *
 * This module is types only. The implementation reaches a model, so it lives in
 * `src/models` — the one module allowed to import a provider SDK (D4, D13) —
 * and is injected through `EngineDeps.planQuery`.
 */

import type { Turn } from "../engine";

export interface QueryPlanInput {
  /** The message exactly as the visitor typed it. */
  message: string;
  /** Prior turns, oldest first. Absent on a first turn. */
  history?: Turn[];
}

export interface QueryPlan {
  /**
   * The question made self-contained: pronouns resolved against history, typos
   * normalised. Also the scoring query — retrieval scores track how a question
   * is phrased at least as much as whether a document answers it, so a
   * conversational fragment scores correct documents poorly. Ranking against
   * the resolved question is what makes the scores mean something.
   */
  canonicalQuestion: string;
  /**
   * Searches to run, `canonicalQuestion` first — it is the one query guaranteed
   * to be a faithful reading of what was asked. Later entries should differ in
   * KIND, not wording: product vocabulary, plain language, the prerequisite
   * step. A reworded canonical question spends a search slot on a search
   * already being run.
   */
  queries: string[];
}

/**
 * The plan for a message no planner ran on: search it as asked.
 *
 * Every failure path resolves here — a planner error, a timeout, a malformed
 * response, or no planner configured at all. Callers therefore never need a
 * null check, and there is exactly one definition of "unplanned".
 */
export function unplannedQuery(message: string): QueryPlan {
  return { canonicalQuestion: message, queries: [message] };
}
