"use server";

import { projects } from "@deskbell/db";
import { type ProjectGaps, ProjectGapsSchema, parseIgnoredTerms } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Gap-clustering settings (spec: gap-cluster-members-and-ignored-terms).
 * Admin-gated like the origin allowlist: this decides how questions are
 * grouped for everyone reading the Gaps page.
 */

export interface GapsFormState {
  error?: string;
  saved?: boolean;
}

export async function saveGapSettings(
  _prev: GapsFormState | undefined,
  formData: FormData,
): Promise<GapsFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  // No list at all is how "the organisation's name" is stored, so that it
  // follows a rename; an explicit list — empty included — overrides it.
  let gaps: ProjectGaps = {};
  if (formData.get("useOrgName") !== "on") {
    const parsed = parseIgnoredTerms(String(formData.get("terms") ?? ""));
    if (!parsed.ok) return { error: parsed.reason };
    const validated = ProjectGapsSchema.safeParse({ ignoredTerms: parsed.terms });
    if (!validated.success) {
      return { error: validated.error.issues[0]?.message ?? "Invalid settings" };
    }
    gaps = validated.data;
  }

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ gaps, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/gaps");
  return { saved: true };
}
