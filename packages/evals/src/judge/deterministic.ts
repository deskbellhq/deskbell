import type { EvalCase, Judge, TargetAnswer, Verdict } from "../types";
import { gradeFromFacts } from "./grade";

/**
 * Lowercase and collapse whitespace, nothing else. Punctuation survives on
 * purpose: marking criteria routinely contain identifiers like
 * `DESKBELL_ALLOW_ANY_ORIGIN` or `::part(panel)`, and stripping punctuation
 * would make those unmatchable.
 */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The default judge: does the answer contain the required facts, as text.
 *
 * It is a substring matcher and cannot recognise a fact stated in different
 * words, so it systematically UNDER-reports factuality. That is acceptable for
 * its job — detecting drift between two runs of the same set — and is exactly
 * why the absolute number belongs to the LLM judge. It needs no key, no
 * network, and returns the same verdict every time.
 */
export function createDeterministicJudge(): Judge {
  return {
    name: "deterministic",
    async grade(evalCase: EvalCase, answer: TargetAnswer): Promise<Verdict> {
      const facts = evalCase.expectedFacts ?? [];
      if (answer.refused) {
        return {
          grade: "C",
          reason: "refused an answerable question",
          matchedFacts: [],
          missingFacts: facts,
          grounded: null,
        };
      }

      const haystack = normalizeForMatch(answer.answer);
      const matchedFacts = facts.filter((f) => haystack.includes(normalizeForMatch(f)));
      const missingFacts = facts.filter((f) => !matchedFacts.includes(f));

      // The same rule the LLM judge's booleans go through: only how presence is
      // decided differs between the two judges.
      const grade = gradeFromFacts(facts, matchedFacts, evalCase.keyFact);

      return {
        grade,
        reason:
          grade === "A"
            ? "all required facts present"
            : grade === "B"
              ? `key fact present, ${missingFacts.length} of ${facts.length} facts missing`
              : "no required fact found in the answer",
        matchedFacts,
        missingFacts,
        // A substring match says nothing about whether the rest of the answer
        // was invented. Groundedness needs a reader, not a matcher.
        grounded: null,
      };
    },
  };
}
