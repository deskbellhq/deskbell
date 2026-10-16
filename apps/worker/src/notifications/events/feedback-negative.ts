import type { FeedbackSummarizer } from "@deskbell/core/models";
import {
  conversations,
  type Database,
  messages,
  projects,
  recordUsage,
  tokensUsedToday,
} from "@deskbell/db";
import {
  type ConversationContext,
  conversationUrl,
  DEFAULT_FEEDBACK_REASON_LABELS,
  type NotificationEvent,
  notificationDeliveryId,
  type ProjectNotifications,
} from "@deskbell/shared";
import { and, asc, eq, isNull, lt } from "drizzle-orm";

/**
 * feedback.negative (spec: project-notifications): from a message id to the
 * event, or null when there is nothing to tell — the row is gone, or the
 * vote was withdrawn before the job ran. The summary is best-effort: budget
 * refused, model failed or timed out, the sentence is the conversation
 * title, then the question, and the event still goes out.
 */

export interface FeedbackMaterial {
  project: {
    id: string;
    name: string;
    reasonLabels: Record<string, string>;
    notifications: Partial<ProjectNotifications>;
  };
  conversation: { id: string; title: string | null; context: ConversationContext | null };
  message: {
    id: string;
    createdAt: Date;
    answer: string;
    feedback: string | null;
    reason: string | null;
    comment: string | null;
  };
  question: string;
}

export interface FeedbackNegativeDeps {
  load(messageId: string): Promise<FeedbackMaterial | null>;
  budget(): Promise<{ limit: number; usedToday: number }>;
  /** Null when the deployment turned summaries off. */
  summarizer: Pick<FeedbackSummarizer, "modelId" | "summarize"> | null;
  recordUsage(usage: { input: number; output: number }): Promise<void>;
  now?: () => Date;
}

const ANSWER_CHARS = 2000;
const QUESTION_SUMMARY_CHARS = 160;

export type BuildOutcome =
  | { event: NotificationEvent }
  | { event: null; reason: "missing" | "withdrawn" };

export async function buildFeedbackNegative(
  deps: FeedbackNegativeDeps,
  subject: Record<string, string>,
  baseUrl: string,
): Promise<BuildOutcome> {
  const messageId = subject.messageId;
  if (!messageId) return { event: null, reason: "missing" };
  const m = await deps.load(messageId);
  if (!m) return { event: null, reason: "missing" };
  if (m.message.feedback !== "down") return { event: null, reason: "withdrawn" };

  const reasonLabel = m.message.reason
    ? (m.project.reasonLabels[m.message.reason] ??
      DEFAULT_FEEDBACK_REASON_LABELS[m.message.reason] ??
      m.message.reason)
    : null;

  const summary = await summarize(deps, m, reasonLabel);
  const now = deps.now?.() ?? new Date();
  return {
    event: {
      id: await notificationDeliveryId({
        projectId: m.project.id,
        event: "feedback.negative",
        subjectKey: m.message.id,
      }),
      type: "feedback.negative",
      version: 1,
      createdAt: now.toISOString(),
      project: { id: m.project.id, name: m.project.name },
      url: conversationUrl({
        baseUrl,
        conversationId: m.conversation.id,
        context: m.conversation.context,
        template: m.project.notifications.conversationLinkTemplate,
      }),
      data: {
        conversation: {
          id: m.conversation.id,
          title: m.conversation.title,
          context: m.conversation.context,
        },
        message: {
          id: m.message.id,
          createdAt: m.message.createdAt.toISOString(),
          question: m.question,
          answer: clip(m.message.answer, ANSWER_CHARS),
        },
        feedback: { reason: m.message.reason, reasonLabel, comment: m.message.comment },
        summary,
      },
    },
  };
}

async function summarize(
  deps: FeedbackNegativeDeps,
  m: FeedbackMaterial,
  reasonLabel: string | null,
): Promise<NotificationEvent["data"]["summary"]> {
  const fallback = () =>
    m.conversation.title
      ? { text: m.conversation.title, source: "title" as const }
      : { text: clip(m.question, QUESTION_SUMMARY_CHARS), source: "question" as const };
  if (!deps.summarizer) return fallback();
  const { limit, usedToday } = await deps.budget();
  if (limit > 0 && usedToday >= limit) return fallback();
  let usage = { input: 0, output: 0 };
  try {
    const text = await deps.summarizer.summarize(
      {
        question: m.question,
        answer: m.message.answer,
        reason: reasonLabel ?? undefined,
        comment: m.message.comment ?? undefined,
      },
      {
        onUsage: (u) => {
          usage = u;
        },
      },
    );
    return text ? { text, source: "model" } : fallback();
  } catch (error) {
    console.warn(
      `[notifications.deliver] summary failed: ${error instanceof Error ? error.name : "error"}`,
    );
    return fallback();
  } finally {
    if (usage.input + usage.output > 0) await deps.recordUsage(usage);
  }
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

export function createFeedbackNegativeDeps(
  db: Database,
  summarizer: FeedbackSummarizer | null,
  scope: { orgId: string; projectId: string },
): FeedbackNegativeDeps {
  return {
    async load(messageId) {
      const [row] = await db
        .select({
          message: {
            id: messages.id,
            createdAt: messages.createdAt,
            content: messages.content,
            feedback: messages.feedback,
            reason: messages.feedbackReason,
            comment: messages.feedbackComment,
          },
          conversation: {
            id: conversations.id,
            title: conversations.title,
            context: conversations.context,
          },
          project: {
            id: projects.id,
            name: projects.name,
            appearance: projects.appearance,
            notifications: projects.notifications,
          },
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .innerJoin(projects, eq(projects.id, conversations.projectId))
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.orgId, scope.orgId),
            eq(conversations.projectId, scope.projectId),
            eq(messages.role, "assistant"),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      // The question is the visitor turn just before this answer.
      const [q] = await db
        .select({ content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.orgId, scope.orgId),
            eq(messages.conversationId, row.conversation.id),
            eq(messages.role, "user"),
            lt(messages.createdAt, row.message.createdAt),
          ),
        )
        .orderBy(asc(messages.createdAt))
        .limit(1)
        .then((rows) => rows.slice(-1));
      const reasonLabels = Object.fromEntries(
        (row.project.appearance.feedbackReasons ?? []).map((r) => [r.id, r.label]),
      );
      return {
        project: {
          id: row.project.id,
          name: row.project.name,
          reasonLabels,
          notifications: row.project.notifications,
        },
        conversation: row.conversation,
        message: {
          id: row.message.id,
          createdAt: row.message.createdAt,
          answer: row.message.content,
          feedback: row.message.feedback,
          reason: row.message.reason,
          comment: row.message.comment,
        },
        question: q?.content ?? row.conversation.title ?? "",
      };
    },
    async budget() {
      const [project] = await db
        .select({ limit: projects.dailyTokenBudget })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
        .limit(1);
      return {
        limit: project?.limit ?? 0,
        usedToday: await tokensUsedToday(db, scope.projectId, scope.orgId),
      };
    },
    summarizer,
    recordUsage(usage) {
      return recordUsage(db, {
        orgId: scope.orgId,
        projectId: scope.projectId,
        usage: { ...usage, embedding: 0 },
      });
    },
  };
}
