"use server";

import { countConversationsPastRetention, projects } from "@deskbell/db";
import { ConversationRetentionDaysSchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole, requireMember } from "@/lib/auth/session";
import { enqueuePurgeConversations } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Conversation retention (spec: conversation-retention). Admin-gated like the
 * origin allowlist and the token budget: this removes data for everyone.
 */

export interface RetentionFormState {
  error?: string;
  saved?: boolean;
  /** The window that was saved, so the form can say what it did. */
  days?: number;
}

/** The field the form submits: the preset, or the custom number when Custom is chosen. */
function readDays(formData: FormData): unknown {
  const preset = String(formData.get("days") ?? "");
  return preset === "custom" ? formData.get("customDays") : preset;
}

export async function saveConversationRetention(
  _prev: RetentionFormState | undefined,
  formData: FormData,
): Promise<RetentionFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  const parsed = ConversationRetentionDaysSchema.safeParse(readDays(formData));
  if (!parsed.success) {
    return { error: "Enter a whole number of days between 1 and 3650, or keep everything." };
  }
  const days = parsed.data;

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ conversationRetentionDays: days, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  // The first removal should not wait for the hourly tick; the job re-reads
  // the window, so a save back to "keep everything" before it runs is a no-op.
  if (days > 0) await enqueuePurgeConversations({ orgId: project.orgId, projectId: project.id });

  revalidatePath("/settings/retention");
  return { saved: true, days };
}

/** How many conversations a window would remove right now; what the Custom field asks. */
export async function countPastRetention(days: number): Promise<number> {
  await requireMember();
  const parsed = ConversationRetentionDaysSchema.safeParse(days);
  if (!parsed.success) return 0;
  const project = await getDefaultProject();
  return countConversationsPastRetention(
    getDb(),
    { orgId: project.orgId, projectId: project.id },
    parsed.data,
  );
}
