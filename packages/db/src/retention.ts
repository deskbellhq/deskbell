import { type SQL, sql } from "drizzle-orm";

import type { Database } from "./index";

/**
 * Conversation retention (spec: conversation-retention): the one predicate
 * that decides a conversation is past its project's window, and the two
 * readers of it — the settings page counts, the worker deletes. They cannot
 * disagree because they cannot be written differently.
 *
 * A conversation is past the window when it started before the cutoff and no
 * message in it was written at or after the cutoff. That is the inbox's
 * definition of latest activity (`coalesce(max(messages.created_at),
 * conversations.created_at)`), and deliberately not `updated_at`, which a
 * rename or a visitor's soft delete bumps and a follow-up turn does not.
 *
 * Every query takes the org and the project (D12).
 */

export interface RetentionScope {
  orgId: string;
  projectId: string;
}

/** The predicate over `conversations` aliased as `c`, for a window of `days`. */
function pastWindow(scope: RetentionScope, days: number): SQL {
  const cutoff = sql`now() - make_interval(days => ${days})`;
  return sql`c.org_id = ${scope.orgId}
    and c.project_id = ${scope.projectId}
    and c.created_at < ${cutoff}
    and not exists (
      select 1 from messages m
      where m.conversation_id = c.id and m.created_at >= ${cutoff}
    )`;
}

/** How many conversations the window would remove right now; 0 for a window of 0. */
export async function countConversationsPastRetention(
  db: Database,
  scope: RetentionScope,
  days: number,
): Promise<number> {
  if (days <= 0) return 0;
  const result = await db.execute<{ n: string | number }>(
    sql`select count(*) as n from conversations c where ${pastWindow(scope, days)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * One count per window in a single pass, for the settings page's presets.
 * Windows of 0 come back as 0 without touching the table.
 */
export async function countConversationsPastRetentionFor(
  db: Database,
  scope: RetentionScope,
  windows: readonly number[],
): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  const positive = windows.filter((d) => d > 0);
  for (const d of windows) counts[d] = 0;
  if (positive.length === 0) return counts;
  // Rows past a wide window are a subset of rows past a narrow one, so the
  // narrowest window bounds the scan and each window is a filter over it.
  const narrowest = Math.min(...positive);
  const filters = positive.map(
    (d) =>
      sql`count(*) filter (where c.created_at < now() - make_interval(days => ${d})
        and not exists (select 1 from messages m where m.conversation_id = c.id
          and m.created_at >= now() - make_interval(days => ${d}))) as ${sql.raw(`d${d}`)}`,
  );
  const result = await db.execute<Record<string, string | number>>(
    sql`select ${sql.join(filters, sql`, `)} from conversations c
      where c.org_id = ${scope.orgId} and c.project_id = ${scope.projectId}
      and c.created_at < now() - make_interval(days => ${narrowest})`,
  );
  const row = result.rows[0] ?? {};
  for (const d of positive) counts[d] = Number(row[`d${d}`] ?? 0);
  return counts;
}

/**
 * Remove up to `limit` conversations past the window, oldest first; messages
 * and tool calls go with them through the cascades. Returns how many rows
 * went. A removed row leaves the predicate, so calling this until it returns
 * fewer than `limit` drains the backlog and a retry is harmless.
 */
export async function purgeConversationsBatch(
  db: Database,
  scope: RetentionScope,
  days: number,
  limit: number,
): Promise<number> {
  if (days <= 0 || limit <= 0) return 0;
  const result = await db.execute(
    sql`delete from conversations where id in (
      select c.id from conversations c where ${pastWindow(scope, days)}
      order by c.created_at asc limit ${limit}
    )`,
  );
  return result.rowCount ?? 0;
}

/** Every project with a window, for the hourly walk. */
export async function listRetentionProjects(
  db: Database,
): Promise<Array<RetentionScope & { days: number }>> {
  const result = await db.execute<{ org_id: string; id: string; days: number }>(
    sql`select org_id, id, conversation_retention_days as days from projects
      where conversation_retention_days > 0 order by created_at asc`,
  );
  return result.rows.map((r) => ({ orgId: r.org_id, projectId: r.id, days: Number(r.days) }));
}

/**
 * The status line's facts, written on every run including one that removed
 * nothing. Never touches `updated_at`: the project was not edited.
 */
export async function recordPurgeRun(
  db: Database,
  scope: RetentionScope,
  removed: number,
  at: Date = new Date(),
): Promise<void> {
  await db.execute(
    sql`update projects set conversations_purged_at = ${at}, conversations_purged_count = ${removed}
      where id = ${scope.projectId} and org_id = ${scope.orgId}`,
  );
}
