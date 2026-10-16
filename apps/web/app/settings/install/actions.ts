"use server";

import { projects } from "@deskbell/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole, requireRole } from "@/lib/auth/session";
import { getSelfHosts, hostOfOrigin } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";
import { normalizeOrigin } from "@/lib/origins";

/**
 * Allowlist mutations (spec: single-tag-embed-deploy-onboarding). Entries are
 * stored canonicalized (normalizeOrigin) so they match the browser Origin
 * header byte-for-byte — widget-cors.ts compares with strict includes().
 * Read-modify-write on the jsonb array is fine at dashboard concurrency:
 * a handful of admins editing settings, not a request path (spec: dashboard-auth).
 */
async function addOriginToProject(rawOrigin: string): Promise<{ error?: string }> {
  const origin = normalizeOrigin(rawOrigin);
  if (!origin) {
    return { error: "Enter a valid origin — scheme and host only, e.g. https://app.example.com" };
  }
  // The deployment's own origin is always allowed and its widget never counts
  // as an install (the dashboard dogfoods it), so allowing it by hand does
  // nothing — and on the getting-started page it would leave step three
  // listening for a beacon that by design never arrives (spec:
  // overview-getting-started).
  const host = hostOfOrigin(origin);
  if (host !== null && (await getSelfHosts()).includes(host)) {
    return {
      error:
        "That is this dashboard's own origin — it is always allowed and never counts as your site. Enter the origin of the site the widget will live on.",
    };
  }
  const project = await getDefaultProject();
  if (!project.allowedOrigins.includes(origin)) {
    await getDb()
      .update(projects)
      .set({ allowedOrigins: [...project.allowedOrigins, origin], updatedAt: new Date() })
      .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  }
  revalidatePath("/settings/install");
  revalidatePath("/");
  return {};
}

/** useActionState shape for the add-origin form. */
export async function addAllowedOrigin(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  return addOriginToProject(String(formData.get("origin") ?? ""));
}

/** Bound-argument shape for one-click "Allow" on an already-seen origin. */
export async function allowOrigin(origin: string): Promise<void> {
  await requireRole("admin");
  await addOriginToProject(origin);
}

export async function removeAllowedOrigin(origin: string): Promise<void> {
  await requireRole("admin");
  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({
      allowedOrigins: project.allowedOrigins.filter((o) => o !== origin),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/install");
  revalidatePath("/");
}

/**
 * The project's daily LLM ceiling (spec: widget-abuse-protection). Rejects
 * anything that is not a whole non-negative number rather than coercing it —
 * a budget silently reset to 0 by a typo means "unlimited", which is the
 * failure nobody notices until the invoice.
 */
export async function setDailyTokenBudget(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const raw = String(formData.get("dailyTokenBudget") ?? "").trim();
  const value = Number(raw);
  if (raw === "" || !Number.isSafeInteger(value) || value < 0) {
    return { error: "Enter a whole number of tokens, or 0 for unlimited." };
  }

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ dailyTokenBudget: value, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));

  revalidatePath("/settings/install");
  return {};
}
