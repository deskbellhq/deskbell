import { z } from "zod";

/**
 * Question topics (spec: question-topics): a project's own list of what
 * visitors ask about, and the label the worker puts on each question. The
 * list is the operator's vocabulary — the server never ships one — plus
 * one built-in bucket, `other`, for a question that fits none of them.
 *
 * A key is the stable identifier stored on messages; the name is what the
 * dashboard shows; the description is what the classifier is told, so it
 * doubles as the tooltip. Keys derive from names, so renaming a topic
 * changes its key: the settings page offers a re-label for that case.
 */

export const TOPIC_LIMIT = 20;
export const TOPIC_NAME_MAX = 60;
export const TOPIC_DESCRIPTION_MAX = 200;
export const TOPIC_KEY_MAX = 48;
/** The built-in bucket: a question that matches no configured topic. */
export const OTHER_TOPIC = "other";
export const OTHER_TOPIC_NAME = "Other";
export const TOPIC_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

export const TopicSchema = z.object({
  key: z.string().min(1).max(TOPIC_KEY_MAX).regex(TOPIC_KEY_PATTERN, "topic keys are identifiers"),
  name: z.string().trim().min(1).max(TOPIC_NAME_MAX),
  description: z.string().trim().max(TOPIC_DESCRIPTION_MAX).default(""),
});
export type Topic = z.infer<typeof TopicSchema>;

export const ProjectTopicsSchema = z
  .array(TopicSchema)
  .max(TOPIC_LIMIT, `Keep the list to ${TOPIC_LIMIT} topics.`)
  .refine((list) => new Set(list.map((t) => t.key)).size === list.length, {
    message: "Two topics share a name — make them distinct.",
  })
  .refine((list) => list.every((t) => t.key !== OTHER_TOPIC), {
    message: `"${OTHER_TOPIC_NAME}" is built in — a question that fits no topic lands there.`,
  });
export type ProjectTopics = z.infer<typeof ProjectTopicsSchema>;

/**
 * A key from a name: lower-case, runs of anything but letters and digits
 * become one hyphen, and a key always starts with a letter so it stays an
 * identifier ("2FA" → "t-2fa"). Diacritics are folded first so "Zamówienia"
 * and "Zamowienia" are one key.
 */
export function topicKey(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = /^[a-z]/.test(folded) ? folded : folded ? `t-${folded}` : "";
  return key.slice(0, TOPIC_KEY_MAX).replace(/-+$/g, "");
}

/**
 * Parse a textarea into topics: one per line, `Name: description`. The
 * description is optional; a colon inside it is kept, since only the first
 * one separates. Blank lines are ignored. Errors name the line.
 */
export function parseTopics(
  raw: string,
): { ok: true; topics: Topic[] } | { ok: false; reason: string } {
  const topics: Topic[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const at = text.indexOf(":");
    const name = (at === -1 ? text : text.slice(0, at)).trim();
    const description = at === -1 ? "" : text.slice(at + 1).trim();
    if (!name) return { ok: false, reason: `"${text}" has no name before the colon.` };
    if (name.length > TOPIC_NAME_MAX) {
      return {
        ok: false,
        reason: `"${name}" is too long — keep a name under ${TOPIC_NAME_MAX} characters.`,
      };
    }
    if (description.length > TOPIC_DESCRIPTION_MAX) {
      return {
        ok: false,
        reason: `The description of "${name}" is too long — keep it under ${TOPIC_DESCRIPTION_MAX} characters.`,
      };
    }
    const key = topicKey(name);
    if (!key) return { ok: false, reason: `"${name}" needs at least one letter or digit.` };
    topics.push({ key, name, description });
  }
  const parsed = ProjectTopicsSchema.safeParse(topics);
  if (parsed.success) return { ok: true, topics: parsed.data };
  return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid topics" };
}

/** The textarea's text for a stored list: the inverse of `parseTopics`. */
export function topicsToText(topics: readonly Topic[]): string {
  return topics.map((t) => (t.description ? `${t.name}: ${t.description}` : t.name)).join("\n");
}

/**
 * What the dashboard calls a stored label: the topic's name, "Other" for
 * the built-in bucket, and the key itself for a label whose topic has since
 * been renamed or removed — it is still a real grouping of real questions.
 */
export function topicName(topics: readonly Topic[], key: string): string {
  if (key === OTHER_TOPIC) return OTHER_TOPIC_NAME;
  return topics.find((t) => t.key === key)?.name ?? key;
}
