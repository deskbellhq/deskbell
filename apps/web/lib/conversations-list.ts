import { conversations, messages } from "@deskbell/db";
import { and, count, desc, eq, sql } from "drizzle-orm";

import {
  type ContextFilter,
  type DayRange,
  DEFAULT_NARROWING,
  type Narrowing,
} from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { readGapsConfig } from "@/lib/gaps-signal";
import type { ThreadStatus } from "@/lib/thread-status";

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
  /** How the thread's answers went: the badge's word (lib/thread-status.ts). */
  status: ThreadStatus;
  /** Any answer the visitor marked down. */
  downvoted: boolean;
  /** Any question that asked for a person (spec: intent-and-signals). */
  wantsHuman: boolean;
  /** Any question that pushed back on the answer before it. */
  pushback: boolean;
}

/** What each quick view of a period would list, uncapped. */
export interface ConversationCounts {
  all: number;
  /** Uncertain, downvoted, or with a question that asked for a person or pushed back. */
  attention: number;
}

export interface ListOptions {
  /** Inclusive UTC days a thread must have a message in; null for all time. */
  range?: DayRange | null;
  limit?: number;
}

/**
 * The per-thread aggregates every list question is asked in terms of: the
 * status, the votes, the labels and the message days. One place, so the
 * rows a view lists, the thread it opens and the counts it shows cannot
 * disagree (spec: conversations-inbox-polish, conversations-date-range,
 * attention-inbox).
 */
function threadAggregates(weakScore: number) {
  const answerCount = sql`count(*) filter (where ${messages.role} = 'assistant')`;
  const refusalCount = sql`count(*) filter (where ${messages.refused})`;
  const weakCount = sql`count(*) filter (where ${messages.role} = 'assistant' and not ${messages.refused} and not ${messages.clarified} and ${messages.retrievalTopScore} is not null and ${messages.retrievalTopScore} < ${weakScore})`;
  const downCount = sql`count(*) filter (where ${messages.feedback} = 'down')`;
  const upCount = sql`count(*) filter (where ${messages.feedback} = 'up')`;
  // Named something the documentation does not contain (spec: answer-verification).
  const unsupportedCount = sql`count(*) filter (where coalesce(cardinality(${messages.unsupportedTerms}), 0) > 0)`;
  // The same bucket the Overview chart draws: a message's UTC calendar day.
  const messageDay = sql`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const hasSignal = (signal: string) =>
    sql<boolean>`bool_or(${messages.role} = 'user' and ${signal} = any(${messages.signals}))`;
  const uncertain = sql<boolean>`(${refusalCount} > 0 or ${weakCount} > 0 or ${unsupportedCount} > 0)`;
  const unanswered = sql<boolean>`(${answerCount} = 0)`;
  const down = sql<boolean>`(${downCount} > 0)`;
  const wantsHuman = hasSignal("wants_human");
  const pushback = hasSignal("pushback");
  return {
    uncertain,
    unanswered,
    certain: sql<boolean>`(not ${unanswered} and not ${uncertain})`,
    down,
    up: sql<boolean>`(${upCount} > 0)`,
    wantsHuman,
    pushback,
    // What asks to be read: everything the row's colour and glyphs mark (spec: attention-inbox).
    attention: sql<boolean>`(${uncertain} or ${down} or ${wantsHuman} or ${pushback})`,
    inRange: (range: DayRange) =>
      sql<boolean>`bool_or(${messageDay} between ${range.from} and ${range.to})`,
    lastMessageAt: sql<Date | null>`max(${messages.createdAt})`,
    hasTopic: (topic: string) =>
      sql<boolean>`bool_or(${messages.role} = 'user' and ${messages.topic} = ${topic})`,
    hasIntent: (intent: string) =>
      sql<boolean>`bool_or(${messages.role} = 'user' and ${messages.intent} = ${intent})`,
    hasSignal,
  };
}

function having(
  agg: ReturnType<typeof threadAggregates>,
  narrowing: Narrowing,
  range: DayRange | null,
) {
  const predicates = [
    narrowing.view === "attention" ? agg.attention : null,
    narrowing.outcome ? agg[narrowing.outcome] : null,
    narrowing.feedback ? agg[narrowing.feedback] : null,
    range ? agg.inRange(range) : null,
    narrowing.topic ? agg.hasTopic(narrowing.topic) : null,
    narrowing.intent ? agg.hasIntent(narrowing.intent) : null,
    narrowing.signal ? agg.hasSignal(narrowing.signal) : null,
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
  narrowing: Narrowing,
  { range = null, limit = DEFAULT_LIMIT }: ListOptions = {},
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
      unanswered: agg.unanswered,
      downvoted: agg.down,
      wantsHuman: agg.wantsHuman,
      pushback: agg.pushback,
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(scope(project, narrowing.context, narrowing.user))
    .groupBy(conversations.id)
    .having(having(agg, narrowing, range))
    // "Newest" is the latest activity: a thread with a fresh follow-up rises.
    .orderBy(desc(sql`coalesce(${agg.lastMessageAt}, ${conversations.createdAt})`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    title: row.title ?? row.question ?? "(no user message)",
    snippet: row.lastMessage ? row.lastMessage.slice(0, SNIPPET_CHARS) : null,
    time: new Date(row.lastMessageAt ?? row.createdAt).toISOString(),
    status: row.unanswered ? "unanswered" : row.uncertain ? "uncertain" : "certain",
    downvoted: Boolean(row.downvoted),
    wantsHuman: Boolean(row.wantsHuman),
    pushback: Boolean(row.pushback),
  }));
}

/** What each quick view of a period would list, under the same narrowings, uncapped. */
export async function countConversations(
  project: { orgId: string; id: string },
  range: DayRange | null,
  narrowing: Narrowing = DEFAULT_NARROWING,
): Promise<ConversationCounts> {
  const db = getDb();
  const agg = threadAggregates(readGapsConfig().weakScore);
  const threads = db
    .select({
      id: conversations.id,
      attention: agg.attention.as("attention"),
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(scope(project, narrowing.context, narrowing.user))
    .groupBy(conversations.id)
    .having(having(agg, { ...narrowing, view: "all" }, range))
    .as("threads");
  const [row] = await db
    .select({
      all: count(),
      attention: sql`count(*) filter (where ${threads.attention})`.mapWith(Number),
    })
    .from(threads);
  return { all: row?.all ?? 0, attention: row?.attention ?? 0 };
}

/** One context key and the ids seen under it, each with the latest name the host sent. */
export interface ContextValues {
  key: string;
  values: Array<{ id: string; name: string | null }>;
}

const CONTEXT_VALUES_LIMIT = 50;

/**
 * What the filter menu can offer for the host's context keys (spec:
 * attention-inbox): every key any conversation of the project carries and
 * up to fifty ids under it, most conversations first, named the way the
 * host last named them. All time, because a filter is picked before a period.
 */
export async function loadContextValues(project: {
  orgId: string;
  id: string;
}): Promise<ContextValues[]> {
  const { rows } = await getDb().execute<{
    key: string;
    id: string;
    name: string | null;
    n: string;
  }>(sql`
    select e.key,
           e.value ->> 'id' as id,
           (array_agg(e.value ->> 'name' order by c.created_at desc)
              filter (where e.value ->> 'name' is not null))[1] as name,
           count(*) as n
    from ${conversations} c, jsonb_each(c.context) e
    where c.org_id = ${project.orgId} and c.project_id = ${project.id}
      and c.context is not null and e.value ->> 'id' is not null
    group by e.key, e.value ->> 'id'
    order by e.key, count(*) desc, 2`);
  const byKey = new Map<string, ContextValues>();
  for (const r of rows) {
    const entry = byKey.get(r.key) ?? { key: r.key, values: [] };
    if (entry.values.length < CONTEXT_VALUES_LIMIT) entry.values.push({ id: r.id, name: r.name });
    byKey.set(r.key, entry);
  }
  return [...byKey.values()];
}
