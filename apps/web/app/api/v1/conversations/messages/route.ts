import { actionCalls, conversations, messages } from "@deskbell/db";
import { ConversationMessagesRequestSchema, type WidgetMessage } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";

import { parseCitations } from "@/lib/conversation";
import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — replay one conversation's messages (spec:
 * widget-conversation-history). The conversation must belong to the caller
 * (spec: end-user-identity: the verified user, else the session); same read
 * guard as the list endpoint (spec: widget-abuse-protection).
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ConversationMessagesRequestSchema.safeParse(body);
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

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, parsed.data.conversationId),
      eq(conversations.orgId, project.orgId),
      eq(conversations.projectId, project.id),
      ownedBy({ sessionId: parsed.data.sessionId, endUser }),
    ),
  });
  if (!conversation) {
    return Response.json({ error: "Unknown conversation" }, { status: 404, headers: cors });
  }

  const [rows, calls] = await Promise.all([
    db.query.messages.findMany({
      where: and(eq(messages.conversationId, conversation.id), eq(messages.orgId, project.orgId)),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    }),
    // The calls each answer made, so a step line or a confirmation card is
    // still there after a reload (spec: mcp-actions).
    db
      .select({
        id: actionCalls.id,
        messageId: actionCalls.messageId,
        title: actionCalls.title,
        status: actionCalls.status,
        summary: actionCalls.summary,
        details: actionCalls.details,
        expiresAt: actionCalls.expiresAt,
        createdAt: actionCalls.createdAt,
      })
      .from(actionCalls)
      .where(
        and(eq(actionCalls.conversationId, conversation.id), eq(actionCalls.orgId, project.orgId)),
      )
      .orderBy(actionCalls.createdAt),
  ]);
  const actionsByMessage = new Map<string, WidgetMessage["actions"]>();
  for (const call of calls) {
    if (!call.messageId) continue;
    const list = actionsByMessage.get(call.messageId) ?? [];
    list.push({
      id: call.id,
      title: call.title,
      status: call.status,
      ...(call.summary ? { summary: call.summary } : {}),
      ...(call.details && call.details.length > 0 ? { details: call.details } : {}),
      ...(call.expiresAt ? { expiresAt: call.expiresAt.toISOString() } : {}),
    });
    actionsByMessage.set(call.messageId, list);
  }

  const replay: WidgetMessage[] = rows.map((row) => {
    const actions = actionsByMessage.get(row.id);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      citations: parseCitations(row.citations),
      refused: row.refused,
      clarified: row.clarified,
      feedback: row.feedback,
      feedbackReason: row.feedbackReason ?? null,
      ...(actions ? { actions } : {}),
      ...(row.unsupportedTerms?.length ? { unsupportedTerms: row.unsupportedTerms } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  });

  return Response.json({ messages: replay }, { headers: cors });
}
