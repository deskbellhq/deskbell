import { summarizeRetrieval } from "@deskbell/core";

/**
 * What makes an answer a docs gap (spec: answer-signal).
 *
 * Two signals come from the visitor — a refusal they saw, a thumbs-down they
 * gave. Two come from the engine: an answer whose best retrieved match
 * scored under a floor, which nobody complains about because it read fine,
 * and an answer that named something the corpus does not contain (spec:
 * answer-verification). Pure functions over the columns the message row
 * carries; the SQL that selects candidate rows lives with the page.
 */

export { GAPS_DEFAULTS, type GapsConfig, readGapsConfig } from "@deskbell/db";
export { summarizeRetrieval };

import { GAPS_DEFAULTS, type GapsConfig, NON_GAP_REFUSAL_REASONS } from "@deskbell/db";

/** The columns classification reads. Every one nullable: a null never flags. */
export interface AnswerSignal {
  refused: boolean;
  /** Asked the visitor a clarifying question instead of answering (spec: clarifying-questions). */
  clarified?: boolean;
  feedback: "up" | "down" | null;
  refusalReason: string | null;
  sourcesNamed: boolean | null;
  retrievalTopScore: number | null;
  /**
   * Names the answer asserted that exist nowhere in the corpus (spec:
   * answer-verification). Null or absent means unchecked; empty means clean.
   */
  unsupportedTerms?: string[] | null;
}

export type GapKind =
  | "refused_no_context"
  | "refused_with_context"
  /** Refused before the reason was recorded — a row from before the column existed. */
  | "refused"
  | "downvoted"
  /** Answered with a name the documentation does not contain. */
  | "unsupported_terms"
  | "weak_answer";

export interface AnswerClass {
  kinds: GapKind[];
  isGap: boolean;
  /** The badge to lead with: refused, then marked down, then unsupported, then weak. */
  primary: GapKind | null;
  /**
   * Answered, and the citations are the whole retrieved set because the model
   * named nothing. Counted, not a gap: with the shipped chat model this is
   * the common case (see the spec's Measurements), so flagging it would flag
   * nearly every answer. It is a generation defect to fix, and this is the
   * number that shows whether it has been.
   */
  unsourced: boolean;
}

export function classifyAnswer(row: AnswerSignal, cfg: GapsConfig = GAPS_DEFAULTS): AnswerClass {
  const kinds: GapKind[] = [];
  // An engine error or an off-topic question is a refusal the visitor saw,
  // not a page the docs lack; it is shown as a refusal and never as a gap.
  // Same list as the SQL predicate, so the page and the route agree.
  const docsRefusal =
    row.refused &&
    !(NON_GAP_REFUSAL_REASONS as readonly string[]).includes(row.refusalReason ?? "");
  if (docsRefusal) {
    if (row.refusalReason === "no_context") kinds.push("refused_no_context");
    else if (row.refusalReason === "no_grounding") kinds.push("refused_with_context");
    else kinds.push("refused");
  }
  if (row.feedback === "down") kinds.push("downvoted");
  // Only an answer can name things: a refusal and a clarifying question are
  // never checked, and a null list is "unchecked", never "clean".
  if (!row.refused && row.clarified !== true && (row.unsupportedTerms?.length ?? 0) > 0) {
    kinds.push("unsupported_terms");
  }
  // Weak is a property of an answer. A refusal has no answer to be weak, and
  // neither does a clarifying question.
  if (!row.refused && isWeakAnswer(row, cfg)) kinds.push("weak_answer");
  return {
    kinds,
    isGap: kinds.length > 0,
    primary: kinds[0] ?? null,
    unsourced: !row.refused && !row.clarified && row.sourcesNamed === false,
  };
}

/** Answered from a best match under the floor. Null scores never flag. */
export function isWeakAnswer(
  row: Pick<AnswerSignal, "retrievalTopScore" | "clarified">,
  cfg: GapsConfig = GAPS_DEFAULTS,
): boolean {
  return (
    row.clarified !== true &&
    row.retrievalTopScore !== null &&
    row.retrievalTopScore < cfg.weakScore
  );
}
