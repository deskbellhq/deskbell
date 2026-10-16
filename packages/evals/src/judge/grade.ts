import type { EvalCase, Grade } from "../types";

/**
 * The grade, derived from which criteria the answer contains.
 *
 * Judges decide presence, one criterion at a time; nothing decides a letter.
 * A model asked to place an answer on a three-point scale is being asked to
 * summarise rather than to observe, and the A/B boundary — "the key fact is
 * there but supporting detail is missing" — is the one no two graders draw in
 * the same place. Both judges now share this rule and differ only in how they
 * decide whether a fact is present.
 */
export function gradeFromFacts(
  required: string[],
  matched: string[],
  keyFact: string | undefined,
): Grade {
  const present = new Set(matched);
  if (required.length > 0 && required.every((f) => present.has(f))) return "A";
  const keyMatched = keyFact ? present.has(keyFact) : present.size > 0;
  return keyMatched ? "B" : "C";
}

/** Matched criteria over required criteria. Null when the case declares none. */
export function factCoverage(required: string[], matched: string[]): number | null {
  if (required.length === 0) return null;
  const present = new Set(matched);
  return required.filter((f) => present.has(f)).length / required.length;
}

/**
 * Splits what a judge claims to have matched into the criteria it really
 * matched and the strings it invented.
 *
 * A judge told to quote the marking criteria verbatim sometimes paraphrases
 * them instead, and a paraphrase scored as a match is a silent point awarded
 * for the wrong reason. Anything outside the criteria is dropped from the score
 * and surfaced as an anomaly.
 */
export function reconcileFacts(
  evalCase: EvalCase,
  claimed: string[],
): { matched: string[]; missing: string[]; anomaly: boolean } {
  const required = evalCase.expectedFacts ?? [];
  const byExact = new Set(required);
  const matched = required.filter((f) => claimed.includes(f));
  const anomaly = claimed.some((f) => !byExact.has(f));
  return {
    matched,
    missing: required.filter((f) => !matched.includes(f)),
    anomaly,
  };
}
