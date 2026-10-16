import type { ConversationTitler } from "@deskbell/core/models";
import {
  conversations,
  type Database,
  messages,
  projects,
  recordUsage,
  tokensUsedToday,
} from "@deskbell/db";
import type { TitleConversationJob } from "@deskbell/shared";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * conversations.title (spec: conversation-context-and-titles): name one
 * conversation from its first exchange with the chat model. Runs only when
 * DESKBELL_THREAD_TITLES=model; by default the first question is the title
 * and nothing is spent.
 *
 * Never overwrites a title the visitor wrote: the ask route stores the
 * trimmed question at creation, and a rename replaces it; this job only
 * replaces that creation-time default. Budget-checked like every other model
 * call the worker makes; usage is recorded against the project.
 */

export interface TitleDeps {
  /** The first question and first answer, or null when the conversation is gone or renamed. */
  loadExchange(conversationId: string): Promise<{ question: string; answer?: string } | null>;
  budget(): Promise<{ limit: number; usedToday: number }>;
  titler: Pick<ConversationTitler, "modelId" | "title">;
  save(conversationId: string, title: string): Promise<void>;
  recordUsage(usage: { input: number; output: number }): Promise<void>;
}

export type TitleOutcome = "titled" | "skipped" | "budget" | "missing";

export async function titleConversation(
  deps: TitleDeps,
  conversationId: string,
): Promise<TitleOutcome> {
  const exchange = await deps.loadExchange(conversationId);
  if (!exchange) return "missing";

  const { limit, usedToday } = await deps.budget();
  if (limit > 0 && usedToday >= limit) return "budget";

  let usage = { input: 0, output: 0 };
  try {
    const title = await deps.titler.title(exchange, {
      onUsage: (u) => {
        usage = u;
      },
    });
    if (!title) return "skipped";
    await deps.save(conversationId, title);
  } finally {
    if (usage.input + usage.output > 0) await deps.recordUsage(usage);
  }
  return "titled";
}

export function createTitleDeps(
  db: Database,
  titler: ConversationTitler,
  scope: { orgId: string; projectId: string },
): TitleDeps {
  const inProject = and(
    eq(conversations.orgId, scope.orgId),
    eq(conversations.projectId, scope.projectId),
  );
  return {
    async loadExchange(conversationId) {
      const [row] = await db
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .where(
          and(inProject, eq(conversations.id, conversationId), isNull(conversations.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      const turns = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(and(eq(messages.orgId, scope.orgId), eq(messages.conversationId, conversationId)))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(2);
      const question = turns.find((t) => t.role === "user")?.content;
      if (!question) return null;
      // Renamed since creation means the visitor chose a title; leave it.
      const creationTitle = question.replace(/\s+/g, " ").trim();
      if (row.title && !creationTitle.startsWith(row.title.replace(/…$/, ""))) return null;
      const answer = turns.find((t) => t.role === "assistant")?.content || undefined;
      return { question, answer };
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
    titler,
    async save(conversationId, title) {
      await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(and(inProject, eq(conversations.id, conversationId)));
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

export async function handleTitleConversation(
  db: Database,
  titler: ConversationTitler,
  job: TitleConversationJob,
): Promise<TitleOutcome> {
  const outcome = await titleConversation(
    createTitleDeps(db, titler, { orgId: job.orgId, projectId: job.projectId }),
    job.conversationId,
  );
  console.log(`[conversations.title] conversation=${job.conversationId} outcome=${outcome}`);
  return outcome;
}
