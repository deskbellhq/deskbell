import { conversations, messages } from "@deskbell/db";
import { and, count, desc, eq, sql } from "drizzle-orm";

import type { ContextFilter, ConversationsFilter, DayRange } from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { readGapsConfig } from "@/lib/gaps-signal";

const SNIPPET_CHARS = 120;
const DEFAULT_LIMIT = 200;

export interface ConversationListRow {
  id: string;
  sessionId: string;
  /** The stored title, or the first question when none was written. */
  title: string;
  snippet: string | null;
  /** ISO timestamp of the latest activity. */
  time: string;
  /** Any refused or weakly grounded answer in the thread (lib/thread-status.ts). */
  uncertain: boolean;
  /** Any answer the visitor marked down. */
  downvoted: boolean;
}

export interface ConversationCounts {
  all: number;
  uncertain: number;
  down: number;
}

export interface ListOptions {
  filter?: ConversationsFilter;
  /** Inclusive UTC days a thread must have a message in; null for all time. */
  range?: DayRange | null;
  /** A topic one of the thread's questions was labelled with (spec: question-topics). */
  topic?: string | null;
  /** A context key and id the thread must carry (spec: usage-page). */
  context?: ContextFilter | null;
  /** The verified visitor who owns the thread (spec: usage-page). */
  user?: string | null;
  limit?: number;
}

/** The thread-level narrowing the usage page drills down with. */
export interface Narrowing {
  topic: string | null;
  context: ContextFilter | null;
  user: string | null;
}

/**
 * The per-thread aggregates every list question is asked in terms of: the
 * two booleans of the filter and the message days of the range. One place,
 * so the rows a view lists, the thread it opens and the counts it shows
 * cannot disagree (spec: conversations-inbox-polish, conversations-date-range).
 */
function threadAggregates(weakScore: number) {
  const refusalCount = sql`count(*) filter (where ${messages.refused})`;
  const weakCount = sql`count(*) filter (where ${messages.role} = 'assistant' and not ${messages.refused} and not ${messages.clarified} and ${messages.retrievalTopScore} is not null and ${messages.retrievalTopScore} < ${weakScore})`;
  const downCount = sql`count(*) filter (where ${messages.feedback} = 'down')`;
  // Named something the documentation does not contain (spec: answer-verification).
  const unsupportedCount = sql`count(*) filter (where coalesce(cardinality(${messages.unsupportedTerms}), 0) > 0)`;
  // The same bucket the Overview chart draws: a message's UTC calendar day.
  const messageDay = sql`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  return {
    uncertain: sql<boolean>`(${refusalCount} > 0 or ${weakCount} > 0 or ${unsupportedCount} > 0)`,
    down: sql<boolean>`(${downCount} > 0)`,
    inRange: (range: DayRange) =>
      sql<boolean>`bool_or(${messageDay} between ${range.from} and ${range.to})`,
    lastMessageAt: sql<Date | null>`max(${messages.createdAt})`,
    hasTopic: (topic: string) =>
      sql<boolean>`bool_or(${messages.role} = 'user' and ${messages.topic} = ${topic})`,
  };
}

function having(
  agg: ReturnType<typeof threadAggregates>,
  filter: ConversationsFilter,
  range: DayRange | null,
  topic: string | null = null,
) {
  const predicates = [
    filter === "uncertain" ? agg.uncertain : filter === "down" ? agg.down : null,
    range ? agg.inRange(range) : null,
    topic ? agg.hasTopic(topic) : null,
  ].filter((p) => p !== null);
  return predicates.length > 0 ? sql.join(predicates, sql` and `) : undefined;
}

/** Project scope, plus the context containment test and the owner when a filter asks for one. */
function scope(
  project: { orgId: string; id: string },
  context: ContextFilter | null,
  user: string | null,
) {
  return and(
    eq(conversations.orgId, project.orgId),
    eq(conversations.projectId, project.id),
    context
      ? sql`${conversations.context} @> ${JSON.stringify({ [context.key]: { id: context.id } })}::jsonb`
      : undefined,
    user ? eq(conversations.endUserId, user) : undefined,
  );
}

/**
 * The inbox list: one aggregate per thread in the view, newest activity
 * first, capped. The list pane asks with the full view, and the index page
 * asks with the same view and a limit of one to learn which thread to open.
 */
export async function listConversations(
  project: { orgId: string; id: string },
  {
    filter = "all",
    range = null,
    topic = null,
    context = null,
    user = null,
    limit = DEFAULT_LIMIT,
  }: ListOptions = {},
): Promise<ConversationListRow[]> {
  const db = getDb();
  // The same weak floor the gaps page flags on (lib/thread-status.ts).
  const agg = threadAggregates(readGapsConfig().weakScore);

  const rows = await db
    .select({
      id: conversations.id,
      sessionId: conversations.sessionId,
      title: conversations.title,
      createdAt: conversations.createdAt,
      question: sql<
        string | null
      >`(array_agg(${messages.content} order by ${messages.createdAt}) filter (where ${messages.role} = 'user'))[1]`,
      lastMessage: sql<
        string | null
      >`(array_agg(${messages.content} order by ${messages.createdAt} desc))[1]`,
      lastMessageAt: agg.lastMessageAt,
      uncertain: agg.uncertain,
      downvoted: agg.down,
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(scope(project, context, user))
    .groupBy(conversations.id)
    .having(having(agg, filter, range, topic))
    // "Newest" is the latest activity: a thread with a fresh follow-up rises.
    .orderBy(desc(sql`coalesce(${agg.lastMessageAt}, ${conversations.createdAt})`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    title: row.title ?? row.question ?? "(no user message)",
    snippet: row.lastMessage ? row.lastMessage.slice(0, SNIPPET_CHARS) : null,
    time: new Date(row.lastMessageAt ?? row.createdAt).toISOString(),
    uncertain: Boolean(row.uncertain),
    downvoted: Boolean(row.downvoted),
  }));
}

/** What each filter segment of a period would list, uncapped. */
export async function countConversations(
  project: { orgId: string; id: string },
  range: DayRange | null,
  narrowing: Narrowing = { topic: null, context: null, user: null },
): Promise<ConversationCounts> {
  const db = getDb();
  const agg = threadAggregates(readGapsConfig().weakScore);
  const threads = db
    .select({
      id: conversations.id,
      uncertain: agg.uncertain.as("uncertain"),
      down: agg.down.as("down"),
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(scope(project, narrowing.context, narrowing.user))
    .groupBy(conversations.id)
    .having(having(agg, "all", range, narrowing.topic))
    .as("threads");
  const [row] = await db
    .select({
      all: count(),
      uncertain: sql`count(*) filter (where ${threads.uncertain})`.mapWith(Number),
      down: sql`count(*) filter (where ${threads.down})`.mapWith(Number),
    })
    .from(threads);
  return { all: row?.all ?? 0, uncertain: row?.uncertain ?? 0, down: row?.down ?? 0 };
}
