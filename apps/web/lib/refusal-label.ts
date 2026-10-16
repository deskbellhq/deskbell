import type { messages } from "@deskbell/db";

type RefusalReason = NonNullable<(typeof messages.$inferSelect)["refusalReason"]>;

/**
 * What a refusal badge says (spec: conversations-inbox-polish). The engine
 * records why it refused (spec: answer-signal); an operator reading a thread
 * should not have to guess whether nothing was retrieved or the retrieved
 * pages did not support an answer. Rows written before the column existed
 * carry null and read as the general case.
 */
const REFUSAL_LABELS: Record<RefusalReason, string> = {
  no_context: "Nothing retrieved",
  no_grounding: "No grounded answer",
  off_topic: "Off topic",
  guardrail: "Blocked by guardrail",
};

export function refusalLabel(reason: string | null | undefined): string {
  return (reason && REFUSAL_LABELS[reason as RefusalReason]) || "No grounded answer";
}

/**
 * The retrieval behind an answer, for a badge tooltip: "3 chunks, best 0.31".
 * Null when the row carries no signal.
 */
export function retrievalSummary(m: {
  retrievalHits: number | null;
  retrievalTopScore: number | null;
}): string | null {
  if (m.retrievalHits == null && m.retrievalTopScore == null) return null;
  const parts: string[] = [];
  if (m.retrievalHits != null) {
    parts.push(`${m.retrievalHits} ${m.retrievalHits === 1 ? "chunk" : "chunks"}`);
  }
  if (m.retrievalTopScore != null) parts.push(`best ${m.retrievalTopScore.toFixed(2)}`);
  return parts.join(", ");
}
