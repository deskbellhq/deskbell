import { conversations, messages } from "@deskbell/db";
import { ConversationListRequestSchema, type WidgetConversation } from "@deskbell/shared";
import { and, desc, eq, sql } from "drizzle-orm";

import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — the visitor's recent conversations (spec:
 * widget-conversation-history). Authorization is ownership (spec:
 * end-user-identity): the verified user's rows, else the session's; POST
 * keeps the session out of URLs and access logs. Cheap read, but it
 * enumerates a visitor's data, so it takes the read guard
 * (spec: widget-abuse-protection). `scope` narrows to conversations whose
 * context carries one key with one id; `limit` caps at 50.
 */

const SNIPPET_CHARS = 120;
const DEFAULT_LIMIT = 20;

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ConversationListRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers: { "access-control-allow-origin": "*" } },
    );
  }

  const guard = await guardWidgetRequest(request, {
    projectKey: parsed.data.projectKey,
    kind: "read",
  });
  if (!guard.ok) return guard.response;
  const { project, cors, endUser } = guard;

  const db = getDb();
  const { scope, limit } = parsed.data;

  const rows = await db
    .select({
      id: conversations.id,
      storedTitle: conversations.title,
      context: conversations.context,
      updatedAt: conversations.updatedAt,
      title: sql<
        string | null
      >`(array_agg(${messages.content} order by ${messages.createdAt}) filter (where ${messages.role} = 'user'))[1]`,
      snippet: sql<
        string | null
      >`left((array_agg(${messages.content} order by ${messages.createdAt} desc))[1], ${SNIPPET_CHARS})`,
      lastMessageAt: sql<Date>`max(${messages.createdAt})`,
    })
    .from(conversations)
    .innerJoin(messages, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        ownedBy({ sessionId: parsed.data.sessionId, endUser }),
        // jsonb path on the stored context: {"<key>": {"id": "<id>"}}.
        scope ? sql`${conversations.context} -> ${scope.key} ->> 'id' = ${scope.id}` : undefined,
      ),
    )
    .groupBy(conversations.id)
    .orderBy(desc(sql`max(${messages.createdAt})`))
    .limit(limit ?? DEFAULT_LIMIT);

  const list: WidgetConversation[] = rows.map((row) => ({
    id: row.id,
    title: row.storedTitle ?? row.title ?? "(no question)",
    snippet: row.snippet ?? "",
    lastMessageAt: new Date(row.lastMessageAt).toISOString(),
    context: row.context ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return Response.json({ conversations: list }, { headers: cors });
}
