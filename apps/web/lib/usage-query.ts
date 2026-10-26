import { conversations, type Database, endUsers, messages } from "@deskbell/db";
import { type SQL, sql } from "drizzle-orm";

import type { Period } from "./gaps";
import { NO_SEGMENT, POWER_USER_DAYS } from "./usage";
import type { UsageView } from "./usage-view";

/**
 * The usage page's reads (spec: usage-page). Everything is a count over
 * visitor questions in a window, joined to the conversation for the project
 * scope, the context and the visitor identity. A visitor is
 * `coalesce(end_user_id, session_id)`: counts are over that opaque id, and
 * only the top-visitors table reads a profile, and only for verified visitors
 * — a browser session is counted and never listed.
 *
 * A "segment" is the value of the split key on the conversation — its `id`,
 * or NO_SEGMENT for a conversation without that key. The page folds raw
 * segments onto the series it keeps (`lib/usage`).
 */

export interface UsageTotals {
  segment: string;
  questions: number;
  conversations: number;
  /** Distinct visitors: verified people, or anonymous browser sessions. */
  visitors: number;
  /** Visitors with questions on more than one UTC day of the window. */
  returning: number;
}

export interface SegmentRow {
  segment: string;
  name: string | null;
  conversations: number;
}

export interface DayRow {
  day: string;
  segment: string;
  questions: number;
}

export interface BreakdownRow {
  id: string;
  /** The latest name the host sent for this id. */
  name: string | null;
  visitors: number;
  conversations: number;
  questions: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface TopicRow {
  /** The stored key, or null for questions not yet labelled. */
  topic: string | null;
  segment: string;
  questions: number;
  conversations: number;
}

export interface VisitorRow {
  /** `end_users.id`, the Conversations page's `?user=` filter. */
  id: string;
  /** What the thread view calls them: name, else email, else the subject. */
  label: string;
  email: string | null;
  questions: number;
  conversations: number;
  /** Distinct UTC days with a question. */
  days: number;
  lastAsked: Date;
}

export interface UsageData {
  /** Context keys any conversation in the window carries, for the controls. */
  keys: string[];
  /** Conversations per raw split value in the window. */
  segments: SegmentRow[];
  totals: UsageTotals[];
  /** The equal-length window before; null for all time. */
  previousTotals: UsageTotals[] | null;
  days: DayRow[];
  /** One row per value of the breakdown key; null when no key is chosen. */
  breakdown: BreakdownRow[] | null;
  /** Conversations in the window that do not carry the breakdown key. */
  breakdownMissing: number;
  topics: TopicRow[];
  previousTopics: Array<{ topic: string | null; questions: number }> | null;
  /** Every verified visitor with a question in the window, most questions first, capped. */
  visitors: VisitorRow[];
  /** How many verified visitors asked, counting past the cap. */
  identifiedVisitors: number;
  /** Verified visitors who asked on POWER_USER_DAYS days or more. */
  powerUsers: number;
  /** Anonymous sessions with a question in the window: counted, not listed. */
  anonymousVisitors: number;
}

export const BREAKDOWN_LIMIT = 100;
export const VISITORS_LIMIT = BREAKDOWN_LIMIT;

interface Window {
  from: Date | null;
  /** Exclusive. */
  to: Date | null;
}

const num = (value: unknown) => Number(value ?? 0);

export async function loadUsage(
  db: Database,
  project: { id: string; orgId: string },
  view: UsageView,
  period: Period,
  now: Date,
): Promise<UsageData> {
  const current: Window = { from: period.from, to: null };
  const previous: Window | null = period.from
    ? { from: period.previousFrom, to: period.from }
    : null;
  const chartFrom = period.from ?? new Date(now.getTime() - 89 * 86_400_000);

  const scope = scopeSql(project, view);
  const segment = segmentSql(view.split);

  const [
    keys,
    segments,
    totals,
    previousTotals,
    days,
    breakdown,
    topics,
    previousTopics,
    visitors,
  ] = await Promise.all([
    loadKeys(db, project, current),
    loadSegments(db, scope, view.split, current),
    loadTotals(db, scope, segment, current),
    previous ? loadTotals(db, scope, segment, previous) : null,
    loadDays(db, scope, segment, { from: chartFrom, to: null }),
    view.by ? loadBreakdown(db, scope, view.by, current) : null,
    loadTopics(db, scope, segment, current),
    previous ? loadTopicTotals(db, scope, previous) : null,
    loadTopVisitors(db, scope, current),
  ]);

  return {
    keys,
    segments,
    totals,
    previousTotals,
    days,
    breakdown: breakdown?.rows ?? null,
    breakdownMissing: breakdown?.missing ?? 0,
    topics,
    previousTopics,
    visitors: visitors.rows,
    identifiedVisitors: visitors.identified,
    powerUsers: visitors.power,
    anonymousVisitors: visitors.anonymous,
  };
}

/** Project scope plus every context filter, as a containment test the GIN index answers. */
function scopeSql(project: { id: string; orgId: string }, view: UsageView): SQL {
  const parts: SQL[] = [
    sql`c.org_id = ${project.orgId}`,
    sql`c.project_id = ${project.id}`,
    sql`c.deleted_at is null`,
  ];
  for (const f of view.filters) {
    parts.push(sql`c.context @> ${JSON.stringify({ [f.key]: { id: f.id } })}::jsonb`);
  }
  return sql.join(parts, sql` and `);
}

/** The split value of a conversation; one constant segment when nothing splits. */
function segmentSql(split: string | null): SQL {
  return split ? sql`coalesce(c.context -> ${split} ->> 'id', ${NO_SEGMENT})` : sql`${NO_SEGMENT}`;
}

function windowSql(column: SQL, window: Window): SQL {
  const parts: SQL[] = [];
  if (window.from) parts.push(sql`${column} >= ${window.from}`);
  if (window.to) parts.push(sql`${column} < ${window.to}`);
  return parts.length > 0 ? sql.join(parts, sql` and `) : sql`true`;
}

/** Visitor questions in the window, with the conversation they belong to. */
function questionsSql(scope: SQL, segment: SQL, window: Window): SQL {
  return sql`
    select ${segment} as segment,
           c.id as conversation_id,
           coalesce(c.end_user_id, c.session_id) as visitor,
           c.end_user_id as end_user_id,
           m.topic as topic,
           m.created_at as created_at,
           to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD') as day
    from ${conversations} c
    join ${messages} m on m.conversation_id = c.id
    where ${scope} and m.role = 'user' and ${windowSql(sql`m.created_at`, window)}`;
}

async function loadKeys(
  db: Database,
  project: { id: string; orgId: string },
  window: Window,
): Promise<string[]> {
  const { rows } = await db.execute<{ key: string }>(sql`
    select distinct k as key
    from ${conversations} c, jsonb_object_keys(c.context) k
    where c.org_id = ${project.orgId} and c.project_id = ${project.id}
      and c.context is not null and ${windowSql(sql`c.created_at`, window)}
    order by 1`);
  return rows.map((r) => r.key);
}

async function loadSegments(
  db: Database,
  scope: SQL,
  split: string | null,
  window: Window,
): Promise<SegmentRow[]> {
  if (!split) return [];
  const segment = segmentSql(split);
  const { rows } = await db.execute<{ segment: string; name: string | null; n: string }>(sql`
    with q as (${questionsSql(scope, segment, window)})
    select q.segment,
           (array_agg(c.context -> ${split} ->> 'name' order by c.created_at desc)
              filter (where c.context -> ${split} ->> 'name' is not null))[1] as name,
           count(distinct q.conversation_id) as n
    from q join ${conversations} c on c.id = q.conversation_id
    group by q.segment`);
  return rows.map((r) => ({ segment: r.segment, name: r.name, conversations: num(r.n) }));
}

async function loadTotals(
  db: Database,
  scope: SQL,
  segment: SQL,
  window: Window,
): Promise<UsageTotals[]> {
  const { rows } = await db.execute<{
    segment: string;
    questions: string;
    conversations: string;
    visitors: string;
    returning: string;
  }>(sql`
    with q as (${questionsSql(scope, segment, window)}),
    per_visitor as (
      select segment, visitor, count(distinct day) as days from q group by 1, 2
    )
    select v.segment,
           (select count(*) from q where q.segment = v.segment) as questions,
           (select count(distinct conversation_id) from q where q.segment = v.segment) as conversations,
           count(*) as visitors,
           count(*) filter (where v.days > 1) as returning
    from per_visitor v
    group by v.segment`);
  return rows.map((r) => ({
    segment: r.segment,
    questions: num(r.questions),
    conversations: num(r.conversations),
    visitors: num(r.visitors),
    returning: num(r.returning),
  }));
}

async function loadDays(db: Database, scope: SQL, segment: SQL, window: Window): Promise<DayRow[]> {
  const { rows } = await db.execute<{ day: string; segment: string; n: string }>(sql`
    with q as (${questionsSql(scope, segment, window)})
    select day, segment, count(*) as n from q group by 1, 2 order by 1`);
  return rows.map((r) => ({ day: r.day, segment: r.segment, questions: num(r.n) }));
}

async function loadBreakdown(
  db: Database,
  scope: SQL,
  by: string,
  window: Window,
): Promise<{ rows: BreakdownRow[]; missing: number }> {
  const { rows } = await db.execute<{
    id: string | null;
    name: string | null;
    visitors: string;
    conversations: string;
    questions: string;
    first_seen: Date | string;
    last_seen: Date | string;
  }>(sql`
    with q as (${questionsSql(scope, sql`${NO_SEGMENT}`, window)})
    select c.context -> ${by} ->> 'id' as id,
           (array_agg(c.context -> ${by} ->> 'name' order by c.created_at desc)
              filter (where c.context -> ${by} ->> 'name' is not null))[1] as name,
           count(distinct q.visitor) as visitors,
           count(distinct q.conversation_id) as conversations,
           count(*) as questions,
           min(q.created_at) as first_seen,
           max(q.created_at) as last_seen
    from q join ${conversations} c on c.id = q.conversation_id
    group by 1
    order by count(*) desc, 1
    limit ${BREAKDOWN_LIMIT + 1}`);
  let missing = 0;
  const out: BreakdownRow[] = [];
  for (const r of rows) {
    if (r.id === null) {
      missing = num(r.conversations);
      continue;
    }
    out.push({
      id: r.id,
      name: r.name,
      visitors: num(r.visitors),
      conversations: num(r.conversations),
      questions: num(r.questions),
      firstSeen: new Date(r.first_seen),
      lastSeen: new Date(r.last_seen),
    });
  }
  return { rows: out.slice(0, BREAKDOWN_LIMIT), missing };
}

async function loadTopics(
  db: Database,
  scope: SQL,
  segment: SQL,
  window: Window,
): Promise<TopicRow[]> {
  const { rows } = await db.execute<{
    topic: string | null;
    segment: string;
    questions: string;
    conversations: string;
  }>(sql`
    with q as (${questionsSql(scope, segment, window)})
    select topic, segment, count(*) as questions, count(distinct conversation_id) as conversations
    from q group by 1, 2`);
  return rows.map((r) => ({
    topic: r.topic,
    segment: r.segment,
    questions: num(r.questions),
    conversations: num(r.conversations),
  }));
}

async function loadTopicTotals(
  db: Database,
  scope: SQL,
  window: Window,
): Promise<Array<{ topic: string | null; questions: number }>> {
  const { rows } = await db.execute<{ topic: string | null; questions: string }>(sql`
    with q as (${questionsSql(scope, sql`${NO_SEGMENT}`, window)})
    select topic, count(*) as questions from q group by 1`);
  return rows.map((r) => ({ topic: r.topic, questions: num(r.questions) }));
}

/**
 * Every verified visitor who asked in the window, most questions first, with
 * the profile the thread view shows for them, plus how many anonymous
 * sessions asked too. The only read of `end_users` on the page; a session
 * has no row to read.
 */
async function loadTopVisitors(
  db: Database,
  scope: SQL,
  window: Window,
): Promise<{ rows: VisitorRow[]; identified: number; power: number; anonymous: number }> {
  const [{ rows }, { rows: counts }] = await Promise.all([
    db.execute<{
      id: string;
      name: string | null;
      email: string | null;
      subject: string;
      questions: string;
      conversations: string;
      days: string;
      last_asked: Date | string;
    }>(sql`
      with q as (${questionsSql(scope, sql`${NO_SEGMENT}`, window)})
      select q.end_user_id as id, u.name, u.email, u.subject,
             count(*) as questions,
             count(distinct q.conversation_id) as conversations,
             count(distinct q.day) as days,
             max(q.created_at) as last_asked
      from q join ${endUsers} u on u.id = q.end_user_id
      group by q.end_user_id, u.name, u.email, u.subject
      order by count(*) desc, max(q.created_at) desc
      limit ${VISITORS_LIMIT}`),
    db.execute<{ identified: string; power: string; anonymous: string }>(sql`
      with q as (${questionsSql(scope, sql`${NO_SEGMENT}`, window)}),
      v as (
        select q.visitor, q.end_user_id is not null as identified, count(distinct q.day) as days
        from q group by 1, 2
      )
      select count(*) filter (where identified) as identified,
             count(*) filter (where identified and days >= ${POWER_USER_DAYS}) as power,
             count(*) filter (where not identified) as anonymous
      from v`),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      label: r.name ?? r.email ?? r.subject,
      email: r.name && r.email ? r.email : null,
      questions: num(r.questions),
      conversations: num(r.conversations),
      days: num(r.days),
      lastAsked: new Date(r.last_asked),
    })),
    identified: num(counts[0]?.identified),
    power: num(counts[0]?.power),
    anonymous: num(counts[0]?.anonymous),
  };
}

/** What the inbox calls a verified visitor it is narrowed to; null when the id is not the project's. */
export async function loadVisitorLabel(
  db: Database,
  project: { id: string; orgId: string },
  id: string,
): Promise<string | null> {
  const { rows } = await db.execute<{ name: string | null; email: string | null; subject: string }>(
    sql`
    select u.name, u.email, u.subject from ${endUsers} u
    where u.id = ${id} and u.org_id = ${project.orgId} and u.project_id = ${project.id}`,
  );
  const u = rows[0];
  return u ? (u.name ?? u.email ?? u.subject) : null;
}

/**
 * What the host called each filtered id, for the toolbar's chips and the
 * inbox's: the latest name any conversation of the project sent with it.
 * Keyed by context key; an id the host never named is absent.
 */
export async function loadContextNames(
  db: Database,
  project: { id: string; orgId: string },
  filters: Array<{ key: string; id: string }>,
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  await Promise.all(
    filters.map(async (f) => {
      const { rows } = await db.execute<{ name: string | null }>(sql`
        select c.context -> ${f.key} ->> 'name' as name
        from ${conversations} c
        where c.org_id = ${project.orgId} and c.project_id = ${project.id}
          and c.context @> ${JSON.stringify({ [f.key]: { id: f.id } })}::jsonb
          and c.context -> ${f.key} ->> 'name' is not null
        order by c.created_at desc
        limit 1`);
      const name = rows[0]?.name;
      if (name) names[f.key] = name;
    }),
  );
  return names;
}
