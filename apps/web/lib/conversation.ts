import type { Turn } from "@deskbell/core";
import { type Database, messages } from "@deskbell/db";
import {
  type Citation,
  CitationSchema,
  UNSUPPORTED_NOTE_DEFAULT,
  unsupportedNote,
} from "@deskbell/shared";
import { and, desc, eq, ne } from "drizzle-orm";

/**
 * Reading conversations back out of the database.
 *
 * This lives in apps/web rather than packages/core because core does not touch
 * the database (D10) — history reaches the engine as data, and the engine never
 * learns where it came from.
 */

/**
 * Turns handed to the engine as context for the next answer.
 *
 * Six is enough to resolve a reference — which is all the question-resolution
 * step needs — without letting a long thread grow the prompt without bound.
 */
export const HISTORY_TURNS = 6;

/**
 * The last `limit` turns of a conversation, oldest first.
 *
 * Ordered descending in SQL so the limit takes the most RECENT turns, then
 * reversed: `asc` with a limit would return the opening of a long thread and
 * silently drop the exchange the visitor is actually continuing.
 *
 * Org-scoped like every read (D12). The caller is responsible for having
 * established that the conversation belongs to this session — this is a read of
 * an id it already holds, not an authorization check.
 */
export async function loadRecentTurns(
  db: Database,
  opts: { orgId: string; conversationId: string; limit?: number; excludeMessageId?: string },
): Promise<Turn[]> {
  const rows = await db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, opts.conversationId),
      eq(messages.orgId, opts.orgId),
      // A turn resumed after a confirmation replays the paused step from its
      // stored messages; the row written when it paused must not appear twice
      // (spec: mcp-actions).
      ...(opts.excludeMessageId ? [ne(messages.id, opts.excludeMessageId)] : []),
    ),
    orderBy: [desc(messages.createdAt), desc(messages.id)],
    limit: opts.limit ?? HISTORY_TURNS,
    columns: { role: true, content: true, clarified: true, unsupportedTerms: true },
  });
  return rows.reverse().map((row) => ({
    role: row.role,
    content: historyContent(row),
    ...(row.clarified ? { clarified: true } : {}),
  }));
}

/**
 * An assistant turn as the model reads it back. A turn that named things the
 * documentation does not contain carries the hedge the visitor saw (spec:
 * answer-verification), so the model sees that it already admitted the
 * name was unverified and does not repeat it with fresh confidence. The
 * stored content stays the answer as written; the hedge is composed here.
 */
export function historyContent(row: {
  role: "user" | "assistant";
  content: string;
  unsupportedTerms?: string[] | null;
}): string {
  if (row.role !== "assistant" || !row.unsupportedTerms?.length) return row.content;
  return `${row.content}\n\n${unsupportedNote(UNSUPPORTED_NOTE_DEFAULT, row.unsupportedTerms)}`;
}

/**
 * A clarifying question as stored and replayed (spec: clarifying-questions):
 * the question, then the options as a list. Markdown in the widget, plain
 * text everywhere else, and readable as the assistant turn when the model
 * sees the thread's history on the visitor's next message.
 */
export function clarificationText(clarify: { question: string; options: string[] }): string {
  return `${clarify.question.trim()}\n\n${clarify.options.map((o) => `- ${o}`).join("\n")}`;
}

/** The stored title before any titling job runs: the question on one line, trimmed. */
export const TITLE_CHARS = 80;
export function titleFromQuestion(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length <= TITLE_CHARS
    ? oneLine
    : `${oneLine.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

/**
 * Citations as they were stored, or null if the column no longer matches the
 * wire schema.
 *
 * Note the failure mode this inherits: `safeParse` on the array fails the WHOLE
 * array if any single element does, so adding a REQUIRED field to Citation
 * would silently blank the citations on every historical message. Any change to
 * that schema has to be optional.
 */
export function parseCitations(value: unknown[] | null): Citation[] | null {
  if (!value) return null;
  const parsed = CitationSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * One citation per document, first occurrence winning.
 *
 * Kept separate from parsing because the two surfaces want different things:
 * the widget replay endpoint returns citations as stored, while a reader
 * wants one pill per source. The engine cites per retrieved chunk, so several
 * chunks of one document arrive as several citations.
 */
export function uniqueByDocument(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.documentId)) return false;
    seen.add(citation.documentId);
    return true;
  });
}
