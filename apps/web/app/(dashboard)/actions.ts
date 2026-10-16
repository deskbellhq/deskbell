"use server";

import { projects } from "@deskbell/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Hide the first-run checklist (spec: single-tag-embed-deploy-onboarding) —
 * the one stored onboarding bit; step completion stays derived from data.
 */
export async function dismissOnboarding(): Promise<void> {
  await requireRole("editor");
  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ onboardingDismissedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/");
}
