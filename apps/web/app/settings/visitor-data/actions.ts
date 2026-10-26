"use server";

import { projects } from "@deskbell/db";
import { type ProjectAnswering, ProjectAnsweringSchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Visitor data settings (spec: own-data-fallback). Admin-gated like the other
 * workspace settings: the reply is what every visitor reads when they ask
 * about their own account.
 */

export interface AnswersFormState {
  error?: string;
  saved?: boolean;
}

export async function saveAnswerSettings(
  _prev: AnswersFormState | undefined,
  formData: FormData,
): Promise<AnswersFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  // A blank field clears the reply, which switches the rule off: the schema
  // never stores an empty string as something to show.
  const typed = String(formData.get("ownDataReply") ?? "").trim();
  const validated = ProjectAnsweringSchema.safeParse(typed ? { ownDataReply: typed } : {});
  if (!validated.success) {
    return { error: validated.error.issues[0]?.message ?? "Invalid settings" };
  }
  const answering: ProjectAnswering = validated.data;

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ answering, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/visitor-data");
  return { saved: true };
}
