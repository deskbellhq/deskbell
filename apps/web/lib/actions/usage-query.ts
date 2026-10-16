import { actionCalls, type Database } from "@deskbell/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * What the audit table says about each tool over a period (spec:
 * actions-ia): how often it ran, how often it failed, how long the
 * successful runs took at the median, and when it last ran. One aggregate
 * feeds the tools table, the tool page and the Overview card.
 */
export interface ToolUsage {
  calls: number;
  failed: number;
  medianMs: number | null;
  lastAt: Date | null;
}

export type UsageMap = Map<string, ToolUsage>;

export function usageKey(serverId: string | null, tool: string): string {
  return `${serverId ?? ""}:${tool}`;
}

export async function loadToolUsage(
  db: Database,
  project: { orgId: string; id: string },
  from: Date | null,
): Promise<UsageMap> {
  const where = [eq(actionCalls.orgId, project.orgId), eq(actionCalls.projectId, project.id)];
  if (from) where.push(gte(actionCalls.createdAt, from));
  const rows = await db
    .select({
      serverId: actionCalls.serverId,
      tool: actionCalls.tool,
      calls: sql<number>`count(*)`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${actionCalls.status} = 'failed')`.mapWith(Number),
      medianMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${actionCalls.latencyMs}) filter (where ${actionCalls.status} = 'succeeded' and ${actionCalls.latencyMs} is not null)`.mapWith(
        (v) => (v === null || v === undefined ? null : Number(v)),
      ),
      lastAt: sql<Date | null>`max(${actionCalls.createdAt})`.mapWith((v) =>
        v === null || v === undefined ? null : new Date(v as string),
      ),
    })
    .from(actionCalls)
    .where(and(...where))
    .groupBy(actionCalls.serverId, actionCalls.tool);
  const map: UsageMap = new Map();
  for (const r of rows) {
    map.set(usageKey(r.serverId, r.tool), {
      calls: r.calls,
      failed: r.failed,
      medianMs: r.medianMs,
      lastAt: r.lastAt,
    });
  }
  return map;
}

/** The whole project at a glance, for the Overview card. */
export function summarizeUsage(map: UsageMap): { calls: number; failed: number } {
  let calls = 0;
  let failed = 0;
  for (const u of map.values()) {
    calls += u.calls;
    failed += u.failed;
  }
  return { calls, failed };
}
