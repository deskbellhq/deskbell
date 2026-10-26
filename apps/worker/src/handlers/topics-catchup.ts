import type { QuestionClassifier } from "@deskbell/core/models";
import { conversations, type Database, messages, projects } from "@deskbell/db";
import type { TopicsCatchupJob } from "@deskbell/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  type ClassifyOutcome,
  type ClassifyScope,
  classifyQuestion,
  createClassifyDeps,
} from "./classify-question";

/**
 * topics.catchup (spec: question-topics): the safety net under the
 * per-question job, and what a re-label runs after the topic list changes.
 *
 * For each project with topics (or the one named), every unlabelled visitor
 * question is labelled, oldest first, up to a cap per run so a backlog from
 * a newly configured list is worked through over a few hours rather than
 * holding this serial worker. A budget refusal ends the project's run: the
 * day is spent, the next hour tries again.
 *
 * Resumable by construction: every label leaves the predicate, so a crash
 * mid-run loses one question and a retry continues.
 */

export const CATCHUP_CAP = 200;

export interface TopicsCatchupDeps {
  /** Projects with a topic list; the one named when the job carries a scope. */
  listProjects(): Promise<ClassifyScope[]>;
  /** Unlabelled visitor questions, oldest first. */
  loadUnlabelled(scope: ClassifyScope, limit: number): Promise<string[]>;
  classify(scope: ClassifyScope, messageId: string): Promise<ClassifyOutcome>;
}

export interface TopicsCatchupSummary {
  projects: number;
  labelled: number;
  /** Projects that hit their daily budget before the backlog was done. */
  budget: number;
}

export async function runTopicsCatchup(
  deps: TopicsCatchupDeps,
  job: TopicsCatchupJob,
  cap = CATCHUP_CAP,
): Promise<TopicsCatchupSummary> {
  const scopes =
    job.orgId && job.projectId
      ? [{ orgId: job.orgId, projectId: job.projectId }]
      : await deps.listProjects();
  const summary: TopicsCatchupSummary = { projects: scopes.length, labelled: 0, budget: 0 };
  for (const scope of scopes) {
    const pending = await deps.loadUnlabelled(scope, cap);
    for (const messageId of pending) {
      const outcome = await deps.classify(scope, messageId);
      if (outcome === "budget") {
        summary.budget += 1;
        break;
      }
      if (outcome === "labelled") summary.labelled += 1;
    }
  }
  return summary;
}

export function createTopicsCatchupDeps(
  db: Database,
  classifier: QuestionClassifier,
): TopicsCatchupDeps {
  return {
    async listProjects() {
      return db
        .select({ orgId: projects.orgId, projectId: projects.id })
        .from(projects)
        .where(sql`jsonb_array_length(${projects.topics}) > 0`);
    },
    async loadUnlabelled(scope, limit) {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.orgId, scope.orgId),
            eq(conversations.projectId, scope.projectId),
            eq(messages.role, "user"),
            isNull(messages.topic),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },
    classify(scope, messageId) {
      return classifyQuestion(createClassifyDeps(db, classifier, scope), messageId);
    },
  };
}

export async function handleTopicsCatchup(
  db: Database,
  classifier: QuestionClassifier,
  job: TopicsCatchupJob,
): Promise<TopicsCatchupSummary> {
  const summary = await runTopicsCatchup(createTopicsCatchupDeps(db, classifier), job);
  console.log(
    `[topics.catchup] projects=${summary.projects} labelled=${summary.labelled} budget=${summary.budget}`,
  );
  return summary;
}
