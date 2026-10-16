import { conversations, messages } from "@deskbell/db";
import { channelsFor, FeedbackRequestSchema } from "@deskbell/shared";
import { and, eq, inArray } from "drizzle-orm";

import { enqueueAssignGapCluster, enqueueNotification } from "@/lib/boss";
import { ownedBy } from "@/lib/conversation-access";
import { getDb } from "@/lib/db";
import { notificationBaseUrl } from "@/lib/notifications/base-url";
import { preflight } from "@/lib/widget-cors";
import { guardWidgetRequest } from "@/lib/widget-guard";

/**
 * Public widget endpoint — upserts a visitor's vote on an assistant message
 * (spec: widget-feedback). No LLM spend, so it takes the read guard: origin
 * binding, bot filtering, per-IP rate limit (spec: widget-abuse-protection).
 *
 * Authorization is ownership (spec: end-user-identity): the vote only lands
 * on an assistant message inside a conversation the caller owns, by verified
 * user or by session, org+project scoped.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = FeedbackRequestSchema.safeParse(body);
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

  // A caller holds many conversations (spec: widget-conversation-history):
  // authorize against the target message's OWN conversation — it must belong
  // to the caller within this org+project.
  const sessionConversations = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        ownedBy({ sessionId: parsed.data.sessionId, endUser }),
      ),
    );

  // Reasons only exist on a downvote: an upvote or a cleared vote wipes them,
  // so stale "inaccurate" flags can't outlive the vote they explained.
  const isDown = parsed.data.feedback === "down";
  const [updated] = await db
    .update(messages)
    .set({
      feedback: parsed.data.feedback,
      feedbackReason: isDown ? (parsed.data.reason ?? null) : null,
      feedbackComment: isDown ? (parsed.data.comment ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(messages.id, parsed.data.messageId),
        eq(messages.orgId, project.orgId),
        inArray(messages.conversationId, sessionConversations),
        eq(messages.role, "assistant"),
      ),
    )
    .returning({
      id: messages.id,
      conversationId: messages.conversationId,
      gapClusterId: messages.gapClusterId,
    });
  if (!updated) {
    return Response.json({ error: "Unknown message" }, { status: 404, headers: cors });
  }

  // A thumbs-down makes an answer a gap (spec: gap-clusters). Clearing a vote
  // leaves the assignment alone: the page decides from the row's current
  // columns whether it still counts.
  if (isDown && !updated.gapClusterId) {
    try {
      await enqueueAssignGapCluster({
        orgId: project.orgId,
        projectId: project.id,
        messageId: updated.id,
      });
    } catch (error) {
      console.error("[feedback] failed to enqueue gap clustering:", error);
    }
  }

  // Tell the project's channels (spec: project-notifications). The base URL
  // comes from the environment, never from this public request's headers.
  // Never inline: the worker builds the message and posts it.
  if (isDown && channelsFor(project.notifications, "feedback.negative").length > 0) {
    try {
      await enqueueNotification({
        orgId: project.orgId,
        projectId: project.id,
        event: "feedback.negative",
        subject: { messageId: updated.id, conversationId: updated.conversationId },
        baseUrl: notificationBaseUrl(),
      });
    } catch (error) {
      console.error("[feedback] failed to enqueue notification:", error);
    }
  }

  return Response.json({ ok: true }, { headers: cors });
}
