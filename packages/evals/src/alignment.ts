import { z } from "zod";
import type { AlignmentReport, EvalCaseResult, Grade } from "./types";

/** `{ "case-id": "A" }` — a human's grade for as many cases as were labelled. */
export const HumanGradesSchema = z.record(z.string(), z.enum(["A", "B", "C"]));
export type HumanGrades = z.infer<typeof HumanGradesSchema>;

export function parseHumanGrades(raw: string): HumanGrades {
  return HumanGradesSchema.parse(JSON.parse(raw));
}

/** A grade counts as acceptable when the answer contained every required fact. */
function acceptable(grade: Grade): boolean {
  return grade === "A";
}

/**
 * How often the judge agrees with a human.
 *
 * A judge is a second system sitting on top of the one being measured, and an
 * unmeasured one turns every quality number into an assertion. This is
 * deliberately kept OUT of the baseline: agreement is a property of a judge and
 * a label file, so gating on it would make relabelling read as a regression.
 *
 * Both numbers are reported because they answer different questions. Exact
 * agreement charges the judge for the A/B boundary, which is the subjective
 * one; binary agreement asks only the question a judge can be held to.
 */
export function scoreAlignment(
  cases: EvalCaseResult[],
  human: HumanGrades,
): AlignmentReport | null {
  const graded = cases.filter(
    (c): c is EvalCaseResult & { grade: Grade } => c.grade !== null && human[c.id] !== undefined,
  );
  if (graded.length === 0) return null;

  let exact = 0;
  let binary = 0;
  const disagreements: Record<string, string> = {};
  for (const c of graded) {
    const label = human[c.id] as Grade;
    if (label === c.grade) exact++;
    else disagreements[c.id] = `${label} → ${c.grade}`;
    if (acceptable(label) === acceptable(c.grade)) binary++;
  }

  return {
    labelled: graded.length,
    exactAgreement: exact / graded.length,
    binaryAgreement: binary / graded.length,
    disagreements,
  };
}
