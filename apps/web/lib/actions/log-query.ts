import { actionCalls, actionServers, type Database, endUsers } from "@deskbell/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { type LogRow, type LogView, STATUS_VIEW } from "./log";

export const LOG_LIMIT = 200;

/**
 * The one statement behind the actions log (spec: actions-log): the page and
 * the export run it with the same view, so what is downloaded is what is
 * shown. The question is the visitor's latest user turn at or before the
 * call, found by time so a call whose message row is gone still has one.
 */
const questionSql = sql<
  string | null
>`(select u.content from messages u where u.conversation_id = ${actionCalls.conversationId} and u.role = 'user' and u.created_at <= ${actionCalls.createdAt} order by u.created_at desc limit 1)`;

export async function loadActionCalls(
  db: Database,
  project: { orgId: string; id: string },
  view: Omit<LogView, "call">,
  from: Date | null,
  { limit = LOG_LIMIT, id }: { limit?: number; id?: string } = {},
): Promise<LogRow[]> {
  const where = [eq(actionCalls.orgId, project.orgId), eq(actionCalls.projectId, project.id)];
  if (id) where.push(eq(actionCalls.id, id));
  if (from) where.push(gte(actionCalls.createdAt, from));
  if (view.status !== "all") where.push(inArray(actionCalls.status, [...STATUS_VIEW[view.status]]));
  if (view.server) where.push(eq(actionCalls.serverId, view.server));
  if (view.tool) where.push(eq(actionCalls.tool, view.tool));
  const rows = await db
    .select({
      id: actionCalls.id,
      createdAt: actionCalls.createdAt,
      respondedAt: actionCalls.respondedAt,
      expiresAt: actionCalls.expiresAt,
      serverId: actionCalls.serverId,
      serverName: actionServers.name,
      tool: actionCalls.tool,
      title: actionCalls.title,
      status: actionCalls.status,
      latencyMs: actionCalls.latencyMs,
      conversationId: actionCalls.conversationId,
      messageId: actionCalls.messageId,
      question: questionSql,
      visitorId: actionCalls.endUserId,
      visitorName: endUsers.name,
      visitorEmail: endUsers.email,
      input: actionCalls.input,
      details: actionCalls.details,
      output: actionCalls.output,
      outputTruncated: actionCalls.outputTruncated,
      error: actionCalls.error,
    })
    .from(actionCalls)
    .leftJoin(actionServers, eq(actionCalls.serverId, actionServers.id))
    .leftJoin(endUsers, eq(actionCalls.endUserId, endUsers.id))
    .where(and(...where))
    .orderBy(desc(actionCalls.createdAt))
    .limit(limit);
  return rows.map(({ visitorEmail, ...r }) => ({
    ...r,
    visitorName: r.visitorName ?? visitorEmail,
    details: r.details ?? null,
    output: r.output ?? null,
  }));
}

/** One call, only when it belongs to the project. */
export async function loadActionCall(
  db: Database,
  project: { orgId: string; id: string },
  id: string,
): Promise<LogRow | null> {
  const rows = await loadActionCalls(
    db,
    project,
    { period: "all", status: "all", server: null, tool: null },
    null,
    { limit: 1, id },
  );
  return rows[0] ?? null;
}

export interface ServerOption {
  id: string;
  name: string;
  tools: { name: string; title: string }[];
}

/** The project's servers and their discovered tools, for the filters. */
export async function loadServerOptions(
  db: Database,
  project: { orgId: string; id: string },
): Promise<ServerOption[]> {
  const rows = await db.query.actionServers.findMany({
    where: and(eq(actionServers.orgId, project.orgId), eq(actionServers.projectId, project.id)),
    columns: { id: true, name: true, tools: true, labels: true },
    orderBy: (s, { asc }) => [asc(s.name)],
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    tools: (s.tools ?? []).map((t) => ({
      name: t.name,
      title: s.labels?.[t.name] ?? t.title ?? t.name,
    })),
  }));
}
