import { conversations, endUsers, messages } from "@deskbell/db";
import { type ConversationPreview, ConversationPreviewRequestSchema } from "@deskbell/shared";
import { and, eq, isNull } from "drizzle-orm";

import { parseCitations } from "@/lib/conversation";
import { getDb } from "@/lib/db";
import { claimMatches } from "@/lib/identity/verify";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — read any conversation of the project, for support
 * staff (spec: conversation-preview). Authorisation is the project's staff
 * claim on a verified end-user token: no claim configured means nobody, and a
 * token without it is refused whoever it belongs to. Ownership does not apply;
 * that is the point. Same read guard as every other list endpoint.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ConversationPreviewRequestSchema.safeParse(body);
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

  const staff = project.identity?.staffClaim;
  if (!staff || !endUser || !claimMatches(endUser.claims, staff.path, staff.value)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: cors });
  }

  const db = getDb();
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, parsed.data.conversationId),
      eq(conversations.orgId, project.orgId),
      eq(conversations.projectId, project.id),
      isNull(conversations.deletedAt),
    ),
  });
  if (!conversation) {
    return Response.json({ error: "Unknown conversation" }, { status: 404, headers: cors });
  }

  const [rows, owner] = await Promise.all([
    db.query.messages.findMany({
      where: and(eq(messages.conversationId, conversation.id), eq(messages.orgId, project.orgId)),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    }),
    conversation.endUserId
      ? db.query.endUsers.findFirst({
          where: and(eq(endUsers.id, conversation.endUserId), eq(endUsers.orgId, project.orgId)),
        })
      : Promise.resolve(null),
  ]);

  const preview: ConversationPreview = {
    conversation: {
      id: conversation.id,
      title: conversation.title ?? rows.find((r) => r.role === "user")?.content.slice(0, 80) ?? "",
      context: conversation.context ?? null,
      createdAt: conversation.createdAt.toISOString(),
    },
    endUser: owner ? { name: owner.name, email: owner.email } : null,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      citations: parseCitations(row.citations),
      refused: row.refused,
      clarified: row.clarified,
      feedback: row.feedback,
      feedbackReason: row.feedbackReason ?? null,
      ...(row.unsupportedTerms?.length ? { unsupportedTerms: row.unsupportedTerms } : {}),
      createdAt: row.createdAt.toISOString(),
    })),
  };

  return Response.json(preview, { headers: cors });
}
