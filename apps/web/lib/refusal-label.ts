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
  no_access: "No access to visitor data",
};

export function refusalLabel(reason: string | null | undefined): string {
  return (reason && REFUSAL_LABELS[reason as RefusalReason]) || "No grounded answer";
}

/**
 * The retrieval behind an answer, for a badge tooltip: "3 chunks, best score
 * 0.31". Null when the row carries no signal.
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
  if (m.retrievalTopScore != null) parts.push(`best score ${m.retrievalTopScore.toFixed(2)}`);
  return parts.join(", ");
}

/**
 * The tooltip of an "Unsupported name" badge (spec: answer-verification): a
 * sentence an operator can read without knowing how the check works, the
 * names quoted so they stand out from the copy, then the retrieval behind
 * the answer when the row carries it.
 */
export function unsupportedTitle(terms: string[], signal?: string | null): string {
  const quoted = terms.map((t) => `"${t}"`);
  const list =
    quoted.length <= 1
      ? quoted.join("")
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  const verb = terms.length === 1 ? "appears" : "appear";
  const head = `The answer named ${list}, which ${verb} nowhere in the documentation.`;
  return signal ? `${head} Retrieval behind the answer: ${signal}.` : head;
}
