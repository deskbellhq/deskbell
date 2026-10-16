import type { Database } from "@deskbell/db";
import { sql } from "drizzle-orm";

/**
 * Fixed-window request counters on Postgres (spec: widget-abuse-protection).
 * Postgres is the only infra dependency (D11), so there is no Redis to reach
 * for — and none is needed: counting is one statement.
 *
 * Fixed rather than sliding windows: the window start is part of the key, so a
 * whole request's buckets are one batched upsert with no bookkeeping. The cost
 * is a possible 2x burst across a boundary, which is the right trade for a
 * spend guard (a sliding log would cost a row per request and a prune per read).
 */

export interface Bucket {
  /** Scope name, e.g. "ask:min" — appears in the key and in nothing else. */
  scope: string;
  /** Salted hash or project id. Never a raw IP (see ./client.ts). */
  subject: string;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Requests allowed per window. 0 disables this bucket. */
  limit: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the offending window rolls over; only meaningful when !ok. */
  retryAfter: number;
  /** Which bucket tripped — logged, never returned to the caller. */
  scope?: string;
}

/** Deterministic from (bucket, time): the same request in the same second hits the same row. */
export function bucketKey(bucket: Bucket, now: Date): string {
  const window = Math.floor(now.getTime() / 1000 / bucket.windowSeconds);
  return `${bucket.scope}:${bucket.subject}:${window}`;
}

/** Seconds left in the bucket's current window — the honest Retry-After. */
export function windowResetIn(bucket: Bucket, now: Date): number {
  const seconds = Math.floor(now.getTime() / 1000);
  return bucket.windowSeconds - (seconds % bucket.windowSeconds);
}

/**
 * Count this request against every bucket at once and report whether any is
 * over its limit.
 *
 * One round-trip for all buckets: `unnest` turns the arrays into rows and the
 * upsert increments each, so adding a dimension costs nothing at request time.
 * Buckets are counted even when another has already tripped — a blocked caller
 * still consumed the attempt, and not counting it would let a spammer keep the
 * cheaper windows clear.
 */
export async function consume(
  db: Database,
  buckets: Bucket[],
  now: Date = new Date(),
): Promise<RateLimitVerdict> {
  const active = buckets.filter((b) => b.limit > 0);
  if (active.length === 0) return { ok: true, retryAfter: 0 };

  const keys = active.map((b) => bucketKey(b, now));
  const expiries = active.map((b) =>
    new Date((Math.floor(now.getTime() / 1000) + windowResetIn(b, now)) * 1000).toISOString(),
  );

  // sql.param, not a bare array: drizzle's template flattens plain arrays into
  // separate chunks, which would produce N placeholders instead of one array.
  const rows = await db.execute<{ key: string; count: number }>(sql`
    insert into rate_limits (key, count, expires_at)
    select k, 1, e::timestamptz
    from unnest(${sql.param(keys)}::text[], ${sql.param(expiries)}::text[]) as t(k, e)
    on conflict (key) do update set count = rate_limits.count + 1
    returning key, count
  `);

  const counts = new Map<string, number>();
  for (const row of rows.rows ?? []) counts.set(row.key, Number(row.count));

  for (const [i, bucket] of active.entries()) {
    const key = keys[i];
    const count = key ? (counts.get(key) ?? 0) : 0;
    if (count > bucket.limit) {
      return { ok: false, retryAfter: windowResetIn(bucket, now), scope: bucket.scope };
    }
  }
  return { ok: true, retryAfter: 0 };
}

// Elapsed windows are deleted by the worker's maintenance.prune job
// (pruneRateLimits in @deskbell/db) — never on the request path.
