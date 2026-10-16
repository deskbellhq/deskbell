"use server";

import { projects } from "@deskbell/db";
import { WidgetAppearanceSchema } from "@deskbell/shared";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Persist the widget appearance a project admin authored on the Appearance page.
 *
 * Validated with the same schema the descriptor generates, so a value the
 * widget could not render never reaches the database — and `clientOnly`
 * options (project key, api url, branding) are rejected outright rather than
 * quietly stripped (spec: widget-customization).
 */
export async function saveAppearance(
  _prev: { error?: string; savedAt?: number } | undefined,
  formData: FormData,
): Promise<{ error?: string; savedAt?: number }> {
  const gate = await checkRole("editor");
  if (gate.error) return { error: gate.error };
  const raw = String(formData.get("appearance") ?? "");
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { error: "Could not read the form." };
  }

  const parsed = WidgetAppearanceSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    return { error: field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid value") };
  }

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ appearance: parsed.data, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  revalidatePath("/settings/appearance");
  return { savedAt: Date.now() };
}
