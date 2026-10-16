import { invitations, members, organizations, users } from "@deskbell/db";
import { newId } from "@deskbell/shared";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { isDashboardRole } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db";

/**
 * Signup policy (spec: dashboard-auth): the first account bootstraps the
 * instance; afterwards sign-up requires a pending invitation. Pure decision
 * function so the whole matrix is unit-testable without a request or a DB.
 */
export type SignupDecision = "first-user" | "invited" | "closed";

export interface PendingInvitationLike {
  status: string;
  expiresAt: Date | null;
}

export function signupDecision(input: {
  userCount: number;
  invitation: PendingInvitationLike | null;
  now: Date;
}): SignupDecision {
  if (input.userCount === 0) return "first-user";
  const inv = input.invitation;
  if (!inv) return "closed";
  if (inv.status !== "pending") return "closed";
  if (inv.expiresAt !== null && inv.expiresAt.getTime() <= input.now.getTime()) return "closed";
  return "invited";
}

/**
 * Before-request gate for the email path. /sign-up/email is the only path
 * that creates users with a password; the OAuth path is gated by
 * validateOAuthUser below, which better-auth calls before it creates,
 * links or signs in a provider user (spec: sign-in-with-google).
 */
export const closedSignupGate = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-up/email") return;
  const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(users);
  const invitation = email ? await pendingInvitationFor(email) : null;
  const decision = signupDecision({
    userCount: row?.n ?? 0,
    invitation,
    now: new Date(),
  });
  if (decision === "closed") {
    throw new APIError("FORBIDDEN", {
      message: "Sign-up is invitation-only. Ask an instance admin for an invite link.",
    });
  }
});

/**
 * The seeded workspace always exists (the compose migrate service seeds in
 * production too), so bootstrap ATTACHES to the oldest org rather than
 * creating one — creating would mint a second org on a free-tier instance (D12).
 */
export async function oldestOrgId(): Promise<string> {
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    orderBy: (o) => [asc(o.createdAt)],
  });
  if (!org) {
    throw new Error("No organization found — run `pnpm db:seed` (dx does this automatically).");
  }
  return org.id;
}

/**
 * databaseHooks.user.create.after: user #1 becomes owner. Later users get
 * their member rows from invitation acceptance, never from here. Benign race
 * accepted for v1 (two simultaneous first sign-ups on a fresh instance):
 * the members unique index makes the duplicate insert a no-op, and the
 * second user simply remains membership-less.
 */
export async function attachFirstUserAsOwner(user: { id: string }): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) !== 1) return;
  await db
    .insert(members)
    .values({
      id: newId("mem"),
      organizationId: await oldestOrgId(),
      userId: user.id,
      role: "owner",
    })
    .onConflictDoNothing();
}

/**
 * databaseHooks.session.create.before: stamp the single org as active.
 * Unconditional on purpose — authorization comes from the members row
 * (requireMember), so stamping a not-yet-accepted invitee's session is safe
 * and means acceptance works without a fresh sign-in.
 */
export async function setActiveOrganization<S extends Record<string, unknown>>(
  session: S,
): Promise<{ data: S & { activeOrganizationId: string } }> {
  return { data: { ...session, activeOrganizationId: await oldestOrgId() } };
}

async function pendingInvitationFor(email: string): Promise<PendingInvitationLike | null> {
  const db = getDb();
  const invitation = await db.query.invitations.findFirst({
    where: and(
      sql`lower(${invitations.email}) = lower(${email})`,
      eq(invitations.status, "pending"),
    ),
    orderBy: (inv) => [asc(inv.createdAt)],
  });
  return invitation ?? null;
}

// ---------------------------------------------------------------------------
// OAuth path (spec: sign-in-with-google)

export type OAuthAction = "create-user" | "link-account" | "sign-in";
export type OAuthDecision =
  | "first-user"
  | "invited"
  | "domain"
  | "existing"
  | "closed"
  | "unverified-email"
  | "domain-denied";

/** The bare domain of an address, lower-cased; empty when there is none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/**
 * Who a social provider may bring in. Pure, so the matrix is a unit test:
 * the provider must vouch for the address; a new user needs to be the first,
 * invited, or from an allowed domain; a known user keeps their access when
 * they already hold a membership, and otherwise must still be on the list
 * when one is set.
 */
export function oauthDecision(input: {
  action: OAuthAction;
  emailVerified: boolean;
  userCount: number;
  invitation: PendingInvitationLike | null;
  domain: string;
  allowedDomains: string[];
  hasMembership: boolean;
  now: Date;
}): OAuthDecision {
  if (!input.emailVerified) return "unverified-email";
  const domainAllowed = input.domain !== "" && input.allowedDomains.includes(input.domain);
  if (input.action === "create-user") {
    const bySignup = signupDecision({
      userCount: input.userCount,
      invitation: input.invitation,
      now: input.now,
    });
    if (bySignup !== "closed") return bySignup;
    return domainAllowed ? "domain" : "closed";
  }
  if (input.hasMembership) return "existing";
  if (input.allowedDomains.length === 0) return "existing";
  return domainAllowed ? "domain" : "domain-denied";
}

/** What the sign-in page is told; the description is for people, the code for tests. */
export const OAUTH_REJECTIONS: Record<
  Extract<OAuthDecision, "closed" | "unverified-email" | "domain-denied">,
  { error: string; errorDescription: string }
> = {
  closed: {
    error: "signup_closed",
    errorDescription: "Sign-up is invitation-only. Ask an instance admin for an invite link.",
  },
  "unverified-email": {
    error: "email_not_verified",
    errorDescription: "Your provider has not verified this email address.",
  },
  "domain-denied": {
    error: "email_domain_not_allowed",
    errorDescription: "This email domain is not allowed to sign in here.",
  },
};

export async function allowedSignInDomains(): Promise<string[]> {
  const db = getDb();
  const [row] = await db
    .select({ domains: organizations.allowedSignInDomains })
    .from(organizations)
    .where(eq(organizations.id, await oldestOrgId()))
    .limit(1);
  return row?.domains ?? [];
}

async function hasMembership(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(members)
    .where(eq(members.userId, userId))
    .limit(1);
  return (row?.n ?? 0) > 0;
}

/**
 * user.validateUserInfo: the OAuth gate. Non-OAuth methods return early — the
 * email path keeps closedSignupGate, whose form-error path is proven.
 */
export async function validateOAuthUser(data: {
  user: { id?: string; email?: string; emailVerified?: boolean } & Record<string, unknown>;
  source: {
    action: OAuthAction;
    method: string;
    oauth?: { providerId: string; profile?: Record<string, unknown> | undefined } | undefined;
  };
}): Promise<undefined | { error: string; errorDescription?: string }> {
  if (data.source.method !== "oauth") return undefined;
  const email = typeof data.user.email === "string" ? data.user.email : "";
  // The mapped user carries the provider's verification flag; the raw
  // profile is the second witness. A new account needs a positive answer;
  // a returning one is refused only on an explicit "not verified".
  const claimed = data.user.emailVerified ?? data.source.oauth?.profile?.email_verified;
  const emailVerified = data.source.action === "create-user" ? claimed === true : claimed !== false;
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(users);
  const [invitation, allowedDomains, member] = await Promise.all([
    email ? pendingInvitationFor(email) : null,
    allowedSignInDomains(),
    data.source.action !== "create-user" && typeof data.user.id === "string"
      ? hasMembership(data.user.id)
      : Promise.resolve(false),
  ]);
  const decision = oauthDecision({
    action: data.source.action,
    emailVerified,
    userCount: row?.n ?? 0,
    invitation,
    domain: emailDomain(email),
    allowedDomains,
    hasMembership: member,
    now: new Date(),
  });
  if (decision === "closed" || decision === "unverified-email" || decision === "domain-denied") {
    return OAUTH_REJECTIONS[decision];
  }
  return undefined;
}

/**
 * databaseHooks.account.create.after, for provider accounts only: the member
 * row the invitation or the domain list promised. The invitation's own accept
 * page is unchanged — it never sees a provider account being created.
 */
export async function joinFromInvitationOrDomain(account: {
  providerId: string;
  userId: string;
}): Promise<void> {
  if (account.providerId === "credential") return;
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, account.userId) });
  if (!user) return;
  if (await hasMembership(user.id)) return;
  const orgId = await oldestOrgId();
  const invitation = await db.query.invitations.findFirst({
    where: and(
      sql`lower(${invitations.email}) = lower(${user.email})`,
      eq(invitations.status, "pending"),
    ),
    orderBy: (inv) => [asc(inv.createdAt)],
  });
  const now = new Date();
  const invitationHolds =
    invitation && (invitation.expiresAt === null || invitation.expiresAt.getTime() > now.getTime());
  let role: string | null = null;
  if (invitationHolds && isDashboardRole(invitation.role)) role = invitation.role;
  else if ((await allowedSignInDomains()).includes(emailDomain(user.email))) role = "viewer";
  if (!role) return;
  await db
    .insert(members)
    .values({ id: newId("mem"), organizationId: orgId, userId: user.id, role })
    .onConflictDoNothing();
  if (invitationHolds) {
    await db
      .update(invitations)
      .set({ status: "accepted" })
      .where(eq(invitations.id, invitation.id));
  }
}
