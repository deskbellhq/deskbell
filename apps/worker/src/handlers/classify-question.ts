import type { QuestionClassifier, TopicChoice } from "@deskbell/core/models";
import {
  conversations,
  type Database,
  messages,
  projects,
  recordUsage,
  tokensUsedToday,
} from "@deskbell/db";
import { type ClassifyQuestionJob, OTHER_TOPIC } from "@deskbell/shared";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * messages.topic (spec: question-topics): label one visitor question with
 * the project's topic that fits it, using the chat model. Runs only for
 * projects with a topic list; a project without one never enqueues it and
 * spends nothing.
 *
 * Never relabels: a row that already carries a topic is left alone, so a
 * retry and the hourly catch-up are no-ops for it. Budget-checked like every
 * other model call the worker makes; usage is recorded against the project.
 */

export interface ClassifyDeps {
  /**
   * The question, the visitor's previous question in the thread and the
   * project's topics; null when the message is gone, already labelled, not
   * a user turn, or the project has no topics.
   */
  loadQuestion(
    messageId: string,
  ): Promise<{ question: string; previous?: string; topics: TopicChoice[] } | null>;
  budget(): Promise<{ limit: number; usedToday: number }>;
  classifier: Pick<QuestionClassifier, "modelId" | "classify">;
  save(messageId: string, topic: string): Promise<void>;
  recordUsage(usage: { input: number; output: number }): Promise<void>;
}

export type ClassifyOutcome = "labelled" | "budget" | "missing";

export async function classifyQuestion(
  deps: ClassifyDeps,
  messageId: string,
): Promise<ClassifyOutcome> {
  const loaded = await deps.loadQuestion(messageId);
  if (!loaded) return "missing";

  const { limit, usedToday } = await deps.budget();
  if (limit > 0 && usedToday >= limit) return "budget";

  let usage = { input: 0, output: 0 };
  try {
    const topic = await deps.classifier.classify(
      { ...loaded, other: OTHER_TOPIC },
      {
        onUsage: (u) => {
          usage = u;
        },
      },
    );
    await deps.save(messageId, topic);
  } finally {
    if (usage.input + usage.output > 0) await deps.recordUsage(usage);
  }
  return "labelled";
}

export interface ClassifyScope {
  orgId: string;
  projectId: string;
}

/**
 * The visitor's question before this one in the same thread, as a
 * correlated subquery (the shape of `gapQuestionSql`): a follow-up inherits
 * its topic from it. Only valid in a query whose FROM is the messages
 * table, unaliased.
 */
const previousQuestionSql = sql<
  string | null
>`(select u.content from ${messages} u where u.conversation_id = "messages"."conversation_id" and u.role = 'user' and (u.created_at, u.id) < ("messages"."created_at", "messages"."id") order by u.created_at desc, u.id desc limit 1)`;

export function createClassifyDeps(
  db: Database,
  classifier: QuestionClassifier,
  scope: ClassifyScope,
): ClassifyDeps {
  return {
    async loadQuestion(messageId) {
      const [project] = await db
        .select({ topics: projects.topics })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
        .limit(1);
      if (!project || project.topics.length === 0) return null;
      const [row] = await db
        .select({ content: messages.content, previous: previousQuestionSql })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.orgId, scope.orgId),
            eq(conversations.projectId, scope.projectId),
            eq(messages.id, messageId),
            eq(messages.role, "user"),
            isNull(messages.topic),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        question: row.content,
        previous: row.previous ?? undefined,
        topics: project.topics.map((t) => ({
          key: t.key,
          name: t.name,
          description: t.description,
        })),
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
    classifier,
    async save(messageId, topic) {
      await db
        .update(messages)
        .set({ topic, updatedAt: new Date() })
        .where(and(eq(messages.orgId, scope.orgId), eq(messages.id, messageId)));
    },
    recordUsage(usage) {
      return recordUsage(db, {
        orgId: scope.orgId,
        projectId: scope.projectId,
        usage: { ...usage, embedding: 0 },
      });
    },
  };
}

export async function handleClassifyQuestion(
  db: Database,
  classifier: QuestionClassifier,
  job: ClassifyQuestionJob,
): Promise<ClassifyOutcome> {
  const outcome = await classifyQuestion(
    createClassifyDeps(db, classifier, { orgId: job.orgId, projectId: job.projectId }),
    job.messageId,
  );
  console.log(`[topics.classify] message=${job.messageId} outcome=${outcome}`);
  return outcome;
}
