"use server";

import { conversations, messages, projects } from "@deskbell/db";
import { parseTopics } from "@deskbell/shared";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { enqueueTopicsCatchup } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Question topics and the labelling switch (spec: question-topics,
 * intent-and-signals). Admin-gated like the gap settings: this decides how
 * every question is grouped on the Usage page, and whether the model is
 * called for it at all.
 */

/**
 * The one switch for everything the classifier writes: off means no model
 * call per question, so no topic, intent or signals. Labels already written
 * stay; the catch-up skips the project.
 */
export async function saveClassifySwitch(on: boolean): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ classifyQuestions: on, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/topics");
  revalidatePath("/usage");
  return {};
}

export interface TopicsFormState {
  error?: string;
  saved?: boolean;
}

export async function saveTopics(
  _prev: TopicsFormState | undefined,
  formData: FormData,
): Promise<TopicsFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  const parsed = parseTopics(String(formData.get("topics") ?? ""));
  if (!parsed.ok) return { error: parsed.reason };

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ topics: parsed.topics, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/topics");
  return { saved: true };
}

/**
 * Clear every label in the project — topic, intent and signals — and label
 * the questions again against the current list and prompt. Labels written
 * so far are the old list's; a renamed topic would otherwise keep counting
 * under its old key.
 */
export async function relabelQuestions(): Promise<{ error?: string; queued?: boolean }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const project = await getDefaultProject();
  const db = getDb();
  const inProject = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.orgId, project.orgId), eq(conversations.projectId, project.id)));
  await db
    .update(messages)
    .set({ topic: null, intent: null, signals: null, updatedAt: new Date() })
    .where(
      and(
        eq(messages.orgId, project.orgId),
        eq(messages.role, "user"),
        or(isNotNull(messages.topic), isNotNull(messages.intent)),
        inArray(messages.conversationId, inProject),
      ),
    );
  try {
    await enqueueTopicsCatchup({ orgId: project.orgId, projectId: project.id });
  } catch (error) {
    console.error("[settings/topics] failed to enqueue relabel:", error);
    return {
      error:
        "Labels were cleared, but the worker could not be reached — the hourly job will label them.",
    };
  }
  revalidatePath("/settings/topics");
  revalidatePath("/usage");
  return { queued: true };
}
