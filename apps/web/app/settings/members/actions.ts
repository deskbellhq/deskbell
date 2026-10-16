"use server";

import { organizations } from "@deskbell/db";
import { parseSignInDomains } from "@deskbell/shared";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { ASSIGNABLE_ROLES, type DashboardRole } from "@/lib/auth/permissions";
import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * Member management (spec: dashboard-auth). Admin+ only. All writes go
 * through getAuth().api.* so the org plugin's own permission checks run too —
 * these gates are defence in depth, not the only fence.
 */

function isAssignable(role: string): role is (typeof ASSIGNABLE_ROLES)[number] {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof APIError && error.message ? error.message : fallback;
}

export async function inviteMember(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  if (!isAssignable(role)) return { error: "Pick a role: viewer, editor, or admin." };
  try {
    await getAuth().api.createInvitation({
      body: { email, role: role as DashboardRole },
      headers: await headers(),
    });
  } catch (error) {
    return { error: messageOf(error, "Could not create the invitation.") };
  }
  revalidatePath("/settings/members");
  return {};
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const gate = await checkRole("admin");
  if (gate.error) return;
  try {
    await getAuth().api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  } catch {
    // Already accepted/cancelled — the refreshed list is the answer either way.
  }
  revalidatePath("/settings/members");
}

export async function changeMemberRole(memberId: string, role: string): Promise<void> {
  const gate = await checkRole("admin");
  if (gate.error || !isAssignable(role)) return;
  try {
    await getAuth().api.updateMemberRole({
      body: { memberId, role: role as DashboardRole },
      headers: await headers(),
    });
  } catch {
    // The plugin refuses e.g. demoting the last owner; the page re-render shows the truth.
  }
  revalidatePath("/settings/members");
}

export async function removeMember(memberId: string): Promise<void> {
  const gate = await checkRole("admin");
  if (gate.error) return;
  try {
    await getAuth().api.removeMember({
      body: { memberIdOrEmail: memberId },
      headers: await headers(),
    });
  } catch {
    // Same: refusal (last owner, self) surfaces as an unchanged list.
  }
  revalidatePath("/settings/members");
}

/**
 * Allowed sign-in domains (spec: sign-in-with-google). Admin+, like
 * invitations: it decides who may join. Stored on the organisation the
 * session is in; the OAuth gate reads it on every provider sign-in.
 */
export async function saveSignInDomains(
  _prev: { error?: string; saved?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const gate = await checkRole("admin");
  if (gate.error || !gate.ctx) return { error: gate.error ?? "Not allowed." };
  const orgId = gate.ctx.session.session.activeOrganizationId;
  if (!orgId) return { error: "Session has no active organization — sign out and back in." };
  const parsed = parseSignInDomains(String(formData.get("domains") ?? ""));
  if (!parsed.ok) return { error: parsed.reason };
  await getDb()
    .update(organizations)
    .set({ allowedSignInDomains: parsed.domains, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
  revalidatePath("/settings/members");
  return { saved: true };
}
