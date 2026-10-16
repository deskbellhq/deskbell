import type { TokenUsage } from "@deskbell/core";

/**
 * Per-project daily LLM spend (spec: widget-abuse-protection). The helpers
 * that read and write today's row live in @deskbell/db so the worker can
 * charge the same row (spec: gap-analysis); this module keeps the web app's
 * surface and the pieces only a request path needs.
 */
export { recordUsage, tokensUsedToday, utcDay } from "@deskbell/db";

/** `TokenUsage` is the engine's own type (@deskbell/core) — one definition, one meaning. */
export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, embedding: 0 };

/** Seconds until UTC midnight — the honest Retry-After for a spent budget. */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
