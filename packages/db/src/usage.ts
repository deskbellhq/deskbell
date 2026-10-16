import { newId } from "@deskbell/shared";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "./index";
import { tokenUsage } from "./schema";

/**
 * Per-project daily LLM spend (spec: widget-abuse-protection).
 *
 * The rate limits protect the deployment; this protects the bill. It lives in
 * the database rather than env because the budget belongs to the project — an
 * agency running one instance for many clients caps each of them separately.
 * Here rather than in the web app because the worker spends tokens too (spec:
 * gap-analysis) and must charge the same row the answer path charges.
 */

/** Structural, so neither the worker nor this package needs the engine's type. */
export interface UsageTotals {
  input: number;
  output: number;
  embedding: number;
}

/** UTC, so "today" means the same thing regardless of where the server runs. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Every token the project has spent today, across all channels. */
export async function tokensUsedToday(
  db: Database,
  projectId: string,
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(${tokenUsage.inputTokens} + ${tokenUsage.outputTokens} + ${tokenUsage.embeddingTokens}, 0)`,
    })
    .from(tokenUsage)
    .where(
      and(
        eq(tokenUsage.projectId, projectId),
        eq(tokenUsage.orgId, orgId),
        eq(tokenUsage.day, utcDay(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Add a call's usage to today's row.
 *
 * Called after the work is done, which is why a request can overshoot the
 * budget by one call: the alternative is reserving tokens up front and
 * reconciling every abort, crash, and short answer — a lot of machinery for a
 * guard whose job is to stop runaway volume, not to bill accurately.
 */
export async function recordUsage(
  db: Database,
  params: { orgId: string; projectId: string; usage: UsageTotals; now?: Date },
): Promise<void> {
  const { orgId, projectId, usage } = params;
  if (usage.input + usage.output + usage.embedding === 0) return;

  await db
    .insert(tokenUsage)
    .values({
      id: newId("tu"),
      orgId,
      projectId,
      day: utcDay(params.now),
      inputTokens: usage.input,
      outputTokens: usage.output,
      embeddingTokens: usage.embedding,
    })
    .onConflictDoUpdate({
      target: [tokenUsage.projectId, tokenUsage.day],
      set: {
        inputTokens: sql`${tokenUsage.inputTokens} + ${usage.input}`,
        outputTokens: sql`${tokenUsage.outputTokens} + ${usage.output}`,
        embeddingTokens: sql`${tokenUsage.embeddingTokens} + ${usage.embedding}`,
        updatedAt: new Date(),
      },
    });
}
