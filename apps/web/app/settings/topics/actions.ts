"use server";

import { conversations, messages, projects } from "@deskbell/db";
import { parseTopics } from "@deskbell/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { enqueueTopicsCatchup } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Question topics (spec: question-topics). Admin-gated like the gap
 * settings: this decides how every question is grouped on the Usage page.
 */

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
 * Clear every label in the project and label the questions again against the
 * current list. Labels written so far are the old list's; a renamed topic
 * would otherwise keep counting under its old key.
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
    .set({ topic: null, updatedAt: new Date() })
    .where(
      and(
        eq(messages.orgId, project.orgId),
        eq(messages.role, "user"),
        isNotNull(messages.topic),
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
