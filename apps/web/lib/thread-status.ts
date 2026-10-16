/**
 * What a thread's status badge says (spec: sources-line-and-thread-status).
 *
 * "Answered" was a tautology — every thread with an assistant reply is
 * answered — so the headline is confidence instead. An answer is uncertain
 * when the agent refused, when it answered from retrieval under the weak
 * floor, or when it named something the documentation does not contain
 * (spec: answer-verification) — the classes the gaps page already flags;
 * one uncertain answer marks the thread, as one refusal did before. "Certain" is a claim about
 * grounding, not correctness: a confidently wrong answer reads Certain until
 * a visitor marks it down.
 */
export type ThreadStatus = "certain" | "uncertain" | "unanswered";

export interface ThreadCounts {
  /** Assistant messages in the thread. */
  answers: number;
  /** Assistant messages that refused. */
  refusals: number;
  /** Assistant messages answered from a best match under the weak floor. */
  weak: number;
  /** Assistant messages that named something the documentation does not contain. */
  unsupported?: number;
  /** User messages in the thread. */
  turns: number;
}

export function threadStatus(c: ThreadCounts): ThreadStatus {
  if (c.answers === 0) return "unanswered";
  return c.refusals > 0 || c.weak > 0 || (c.unsupported ?? 0) > 0 ? "uncertain" : "certain";
}

/**
 * Why a thread is uncertain, beside the badge: "refused", "weak grounding",
 * or on a longer thread its shape — "1 of 4 refused · 1 weak" reads
 * differently from "4 of 4 refused". Null when there is nothing to explain.
 */
export function threadStatusDetail(
  c: Pick<ThreadCounts, "refusals" | "weak" | "unsupported" | "turns">,
): string | null {
  const unsupported = c.unsupported ?? 0;
  if (c.refusals === 0 && c.weak === 0 && unsupported === 0) return null;
  const parts: string[] = [];
  if (c.refusals > 0) parts.push(c.turns > 1 ? `${c.refusals} of ${c.turns} refused` : "refused");
  if (c.weak > 0) parts.push(c.turns > 1 ? `${c.weak} weak` : "weak grounding");
  if (unsupported > 0) {
    parts.push(c.turns > 1 ? `${unsupported} unsupported` : "unsupported name");
  }
  return parts.join(" · ");
}
