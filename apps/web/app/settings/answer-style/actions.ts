"use server";

import { projects } from "@deskbell/db";
import { ANSWER_STYLE_MAX_LENGTH, AnswerStyleSchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Answer style (spec: answer-style). Admin-gated like the origin allowlist:
 * this changes what every visitor hears from the next answer on.
 */

export interface AnswerStyleFormState {
  error?: string;
  saved?: boolean;
  /** Whether a style was saved or the field was cleared, so the form can say which. */
  cleared?: boolean;
}

export async function saveAnswerStyle(
  _prev: AnswerStyleFormState | undefined,
  formData: FormData,
): Promise<AnswerStyleFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  const parsed = AnswerStyleSchema.safeParse(String(formData.get("answerStyle") ?? ""));
  if (!parsed.success) {
    return { error: `Keep the style under ${ANSWER_STYLE_MAX_LENGTH} characters.` };
  }

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ answerStyle: parsed.data, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/answer-style");
  return { saved: true, cleared: parsed.data === "" };
}
