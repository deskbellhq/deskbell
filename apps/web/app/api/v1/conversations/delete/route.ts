import { conversations } from "@deskbell/db";
import { ConversationDeleteRequestSchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";

import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — a visitor removes one of their conversations
 * (spec: conversation-context-and-titles). A soft delete: the row and its
 * messages stay for the dashboard and the gap analytics that were built on
 * them; every visitor-facing read excludes it from now on. POST + JSON like
 * the other conversation endpoints, so the session stays out of URLs.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ConversationDeleteRequestSchema.safeParse(body);
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

  const [deleted] = await getDb()
    .update(conversations)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(conversations.id, parsed.data.conversationId),
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        ownedBy({ sessionId: parsed.data.sessionId, endUser }),
      ),
    )
    .returning({ id: conversations.id });
  if (!deleted) {
    return Response.json({ error: "Unknown conversation" }, { status: 404, headers: cors });
  }
  return Response.json({ ok: true }, { headers: cors });
}
