import type { Classification, QuestionClassifier, TopicChoice } from "@deskbell/core/models";
import {
  conversations,
  type Database,
  messages,
  projects,
  recordUsage,
  tokensUsedToday,
} from "@deskbell/db";
import { type ClassifyQuestionJob, OTHER_TOPIC } from "@deskbell/shared";
import { and, eq, isNull, or, sql } from "drizzle-orm";

/**
 * messages.topic, .intent and .signals (spec: question-topics,
 * intent-and-signals): label one visitor question with the project's topic
 * that fits it, why it was asked and how it is going, in one chat-model
 * call. Runs while the project's `classifyQuestions` switch is on; the
 * topic is null for a project without a topic list.
 *
 * Never relabels a finished row: one with an intent and, where the project
 * has topics, a topic is left alone, so a retry and the hourly catch-up are
 * no-ops for it. A row labelled before the project named topics is picked
 * up again so it gets one. Budget-checked like every other model call the
 * worker makes; usage is recorded against the project.
 */

export interface ClassifyDeps {
  /**
   * The question, the visitor's previous question in the thread, the
   * project's name and its topics (empty when it has none); null when the message is
   * gone, already labelled, or not a user turn; "off" when the project has
   * labelling switched off.
   */
  loadQuestion(
    messageId: string,
  ): Promise<
    { question: string; previous?: string; product: string; topics: TopicChoice[] } | null | "off"
  >;
  budget(): Promise<{ limit: number; usedToday: number }>;
  classifier: Pick<QuestionClassifier, "modelId" | "classify">;
  save(messageId: string, labels: Classification): Promise<void>;
  recordUsage(usage: { input: number; output: number }): Promise<void>;
}

export type ClassifyOutcome = "labelled" | "budget" | "missing" | "off";

export async function classifyQuestion(
  deps: ClassifyDeps,
  messageId: string,
): Promise<ClassifyOutcome> {
  const loaded = await deps.loadQuestion(messageId);
  if (loaded === "off") return "off";
  if (!loaded) return "missing";

  const { limit, usedToday } = await deps.budget();
  if (limit > 0 && usedToday >= limit) return "budget";

  let usage = { input: 0, output: 0 };
  try {
    const labels = await deps.classifier.classify(
      { ...loaded, other: OTHER_TOPIC },
      {
        onUsage: (u) => {
          usage = u;
        },
      },
    );
    await deps.save(messageId, labels);
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
 * its topic from it, and pushback is pushback against it. Only valid in a
 * query whose FROM is the messages table, unaliased.
 */
const previousQuestionSql = sql<
  string | null
>`(select u.content from ${messages} u where u.conversation_id = "messages"."conversation_id" and u.role = 'user' and (u.created_at, u.id) < ("messages"."created_at", "messages"."id") order by u.created_at desc, u.id desc limit 1)`;

/**
 * A user row that still needs the classifier: never labelled, or labelled
 * before the project named topics. The same predicate the pending index
 * covers, narrowed by whether this project has topics at all.
 */
export function pendingPredicate(hasTopics: boolean) {
  return hasTopics ? or(isNull(messages.intent), isNull(messages.topic)) : isNull(messages.intent);
}

export function createClassifyDeps(
  db: Database,
  classifier: QuestionClassifier,
  scope: ClassifyScope,
): ClassifyDeps {
  return {
    async loadQuestion(messageId) {
      const [project] = await db
        .select({ name: projects.name, topics: projects.topics, on: projects.classifyQuestions })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
        .limit(1);
      if (!project) return null;
      if (!project.on) return "off";
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
            pendingPredicate(project.topics.length > 0),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        question: row.content,
        previous: row.previous ?? undefined,
        product: project.name,
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
    async save(messageId, labels) {
      await db
        .update(messages)
        .set({
          topic: labels.topic,
          intent: labels.intent,
          signals: labels.signals,
          updatedAt: new Date(),
        })
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
