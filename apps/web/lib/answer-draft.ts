/**
 * The draft action's result and its words (spec: answer-drafting). A
 * discriminated result rather than a message the form has to match on, and
 * the copy for each reason beside it, so the wording is unit-tested and the
 * client bundle carries nothing but strings. No React, no database, no
 * model, no imports.
 */

export type DraftFailureReason = "budget" | "forbidden" | "missing" | "model";

export type DraftResult =
  | {
      ok: true;
      /** The answer, with a bracketed blank wherever the material settled nothing. */
      answer: string;
      /** One per blank, in the order they appear; empty when nothing was left open. */
      blanks: string[];
    }
  | { ok: false; reason: DraftFailureReason; message: string };

export interface DraftFailureCopy {
  /** The line under the field. */
  short: string;
  /** What to do about it, when there is something to do. */
  advice?: string;
}

export function draftFailureCopy(reason: DraftFailureReason, message = ""): DraftFailureCopy {
  switch (reason) {
    case "budget":
      return {
        short: "Daily token budget reached",
        advice: "Drafting spends tokens like answering does. The budget resets at midnight UTC.",
      };
    case "forbidden":
      return { short: "You do not have permission to draft answers" };
    case "missing":
      return {
        short: "This gap is no longer there",
        advice: "It may have been regrouped. Reload the page.",
      };
    default:
      return {
        short: "The model could not draft this",
        advice: message || "Try again, or write the answer yourself.",
      };
  }
}

/**
 * What the form says under the textarea once a draft is in it. The blanks
 * are the work that is left, so they are counted rather than described.
 */
export function blanksSummary(blanks: string[]): string {
  if (blanks.length === 0) {
    return "Drafted from the pages the assistant had. Check every fact before saving.";
  }
  const count = blanks.length === 1 ? "1 blank" : `${blanks.length} blanks`;
  return `Drafted with ${count} to fill — the pages did not settle these. Check the rest before saving.`;
}
