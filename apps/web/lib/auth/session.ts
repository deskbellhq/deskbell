import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "@/lib/auth";
import { type DashboardRole, isDashboardRole, ROLE_RANK } from "@/lib/auth/permissions";

/**
 * Server-side session access (spec: dashboard-auth). THIS is the security
 * boundary: every page and server action reaches data through these helpers
 * (via getDefaultProject), so a request with no valid session never touches
 * a query. proxy.ts only smooths UX; it decides nothing.
 */

/** Request-cached session lookup — many callers per render, one DB/cookie read. */
export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

export type SessionData = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export interface MemberContext {
  session: SessionData;
  role: DashboardRole;
  memberId: string;
}

/**
 * Session + membership in the active org. A signed-in user with no member row
 * (invited, account created, invitation never accepted — or removed since) is
 * authenticated but authorized for nothing.
 */
export const requireMember = cache(async (): Promise<MemberContext> => {
  const session = await requireSession();
  // getActiveMember THROWS (MEMBER_NOT_FOUND) rather than returning null when
  // the user has no member row — verified live with a cookie-cached session
  // whose membership had been deleted underneath it.
  let member: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getActiveMember"]>> | null;
  try {
    member = await getAuth().api.getActiveMember({ headers: await headers() });
  } catch {
    member = null;
  }
  if (!member || !isDashboardRole(member.role)) redirect("/login?reason=no-membership");
  return { session, role: member.role, memberId: member.id };
});

/** Minimum-role gate for mutations; reads stay at requireMember level. */
export async function requireRole(min: DashboardRole): Promise<MemberContext> {
  const ctx = await requireMember();
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw new Error(`This action requires the ${min} role (you have ${ctx.role}).`);
  }
  return ctx;
}

/** Non-throwing variant for useActionState error shapes. */
export async function checkRole(
  min: DashboardRole,
): Promise<{ ctx: MemberContext; error?: never } | { ctx?: never; error: string }> {
  const ctx = await requireMember();
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    return { error: `This action requires the ${min} role (you have ${ctx.role}).` };
  }
  return { ctx };
}
