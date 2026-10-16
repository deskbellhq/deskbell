import { sql } from "drizzle-orm";

import type { Database } from "./index";

/**
 * Housekeeping the worker runs on a schedule, never on a request path
 * (spec: widget-abuse-protection).
 */

/**
 * Drop elapsed rate-limit windows.
 *
 * The counters stay correct without this — an elapsed window is simply never
 * read again, because the window start is part of the key. Pruning only stops
 * the table growing forever, which is why it is a scheduled job and not
 * something the guard does opportunistically on its way to answering someone.
 */
export async function pruneRateLimits(db: Database): Promise<number> {
  const result = await db.execute(sql`delete from rate_limits where expires_at < now()`);
  return result.rowCount ?? 0;
}

/**
 * Flip confirmation requests nobody answered in time (spec: mcp-actions).
 * The ask route already refuses an expired request; this makes the audit row
 * and the widget's replayed card say so.
 */
export async function expirePendingActions(db: Database): Promise<number> {
  const result = await db.execute(
    sql`update action_calls set status = 'expired', updated_at = now()
        where status = 'pending_approval' and expires_at < now()`,
  );
  return result.rowCount ?? 0;
}
