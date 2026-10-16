import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Corrections (spec: corrections-source): answers written in the dashboard,
 * stored as documents under the project's corrections source. Pure helpers
 * — the shape of the stored text and the form contract — so the round trip
 * from form to document and back is testable without a database.
 */

export const CORRECTION_QUESTION_MAX = 300;
export const CORRECTION_ANSWER_MAX = 20_000;

export const CorrectionInputSchema = z.object({
  /** Present when editing; absent when writing a new answer. */
  id: z.string().min(1).optional(),
  /** The gap cluster this answers; saving resolves it. */
  clusterId: z.string().min(1).optional(),
  question: z
    .string()
    .trim()
    .min(1, "Write the question the answer is for")
    .max(
      CORRECTION_QUESTION_MAX,
      `The question must be at most ${CORRECTION_QUESTION_MAX} characters`,
    )
    .refine((s) => !/[\r\n]/.test(s), "The question must be one line"),
  answer: z
    .string()
    .trim()
    .min(1, "Write the answer")
    .max(CORRECTION_ANSWER_MAX, `The answer must be at most ${CORRECTION_ANSWER_MAX} characters`),
});
export type CorrectionInput = z.infer<typeof CorrectionInputSchema>;

/**
 * The stored text: the question as a level-one heading, then the answer.
 * The chunker keeps the heading in the chunk that starts with it and
 * prefixes the heading trail to the rest, so the question is inside the
 * embedded text of every chunk.
 */
export function correctionContent(question: string, answer: string): string {
  return `# ${question}\n\n${answer}`;
}

/** The answer back out of the stored text; the whole text when the heading is not there. */
export function correctionAnswer(title: string, content: string | null): string {
  if (content === null) return "";
  const prefix = `# ${title}\n\n`;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}

/** The same hash the crawler path writes, so a document reads the same whichever way it came. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** A one-line preview for the list, at most `max` characters. */
export function answerExcerpt(answer: string, max = 160): string {
  const flat = answer.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function parseCorrectionForm(
  formData: FormData,
): { data: CorrectionInput; error?: never } | { data?: never; error: string } {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const parsed = CorrectionInputSchema.safeParse({
    id: field("id"),
    clusterId: field("clusterId"),
    question: field("question") ?? "",
    answer: field("answer") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid answer" };
  return { data: parsed.data };
}
