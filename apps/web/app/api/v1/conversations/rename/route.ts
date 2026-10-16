import { conversations } from "@deskbell/db";
import { ConversationRenameRequestSchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";

import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — a visitor renames one of their conversations
 * (spec: conversation-context-and-titles). The title is the visitor's from
 * then on: the titling job never overwrites a stored title.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ConversationRenameRequestSchema.safeParse(body);
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

  const [renamed] = await getDb()
    .update(conversations)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(
      and(
        eq(conversations.id, parsed.data.conversationId),
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        ownedBy({ sessionId: parsed.data.sessionId, endUser }),
      ),
    )
    .returning({ id: conversations.id, title: conversations.title });
  if (!renamed) {
    return Response.json({ error: "Unknown conversation" }, { status: 404, headers: cors });
  }
  return Response.json({ ok: true, title: renamed.title }, { headers: cors });
}
