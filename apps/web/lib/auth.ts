import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { authConfig } from "@/lib/auth/config";
import {
  attachFirstUserAsOwner,
  closedSignupGate,
  joinFromInvitationOrDomain,
  setActiveOrganization,
  validateOAuthUser,
} from "@/lib/auth/hooks";
import { sendInvitationEmail } from "@/lib/auth/invitation-email";
import { ac, roles } from "@/lib/auth/permissions";
import { sendPasswordResetEmail } from "@/lib/auth/reset-password-email";
import { getDb } from "@/lib/db";

/**
 * Dashboard operator auth (spec: dashboard-auth). Email+password is the
 * zero-configuration default and must work on a fresh `docker compose up`
 * with Postgres as the only dependency. Google sign-in (spec:
 * sign-in-with-google) is a login method registered only when its two
 * variables are set; single sign-on through an identity provider is the EE
 * plugin (D03) and is not this.
 *
 * The org plugin rides the EXISTING organizations table: `usePlural` resolves
 * model `organization` to schema key `organizations`, so members, invitations
 * and the session's activeOrganizationId all point at the same org ids every
 * tenant table FKs (D12).
 */
function createAuth() {
  const cfg = authConfig();
  return betterAuth({
    appName: "Deskbell",
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    database: drizzleAdapter(getDb(), { provider: "pg", usePlural: true }),
    // Registered only when configured: an absent provider means no button
    // and no callback route, and the self-host bar is untouched.
    socialProviders: cfg.google
      ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret } }
      : {},
    user: {
      // The OAuth gate: first user, invited, or an allowed domain; the
      // email path keeps closedSignupGate below.
      validateUserInfo: validateOAuthUser,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // No local account is email-verified (sign-up never sent
        // verification mail — invited people were vouched for by an admin),
        // and better-auth refuses implicit linking to an unverified local
        // user regardless of the trusted list. The takeover that gate
        // defends against — registering someone else's address with a
        // password and waiting for them to sign in with Google — cannot
        // happen here: sign-up is invitation-only and an invitation fixes
        // the address. Deprecated upstream; if it goes, an explicit link
        // action on the Account page is the replacement.
        requireLocalEmailVerified: false,
      },
    },
    // A rejected OAuth sign-in lands on the sign-in page with ?error=…,
    // which the page turns into a sentence, rather than on the library's
    // own error page.
    onAPIError: { errorURL: "/login" },
    emailAndPassword: {
      enabled: true,
      // Verification mails stay off: sign-up is first-user-or-invited, so a
      // verification loop would only gate people an admin already vouched
      // for. Invitations remain copyable links (spec: dashboard-auth).
      requireEmailVerification: false,
      // A reset proves control of the mailbox, not of existing sessions —
      // killing them is what makes the flow usable as account-takeover
      // recovery (spec: password-reset-email).
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Our own URL rather than the plugin's /api/auth hop: the emailed
        // link lands directly on /reset-password and the token is consumed
        // only by the actual reset (spec: password-reset-email).
        const url = `${authConfig().baseURL}/reset-password?token=${encodeURIComponent(token)}`;
        try {
          await sendPasswordResetEmail(user, url);
        } catch (error) {
          // Swallowed on purpose: the route must answer identically whether
          // or not the account exists, so a mailer failure may not turn into
          // a distinguishable response. Never log the URL — it is a
          // credential.
          console.error(
            "Password-reset email was not sent:",
            error instanceof Error ? error.message : error,
          );
        }
      },
    },
    session: {
      // Cuts the per-request session lookup; role checks on mutations still
      // hit the DB via getActiveMember, so revocation bites immediately where
      // it matters and page READS lag at most this many seconds.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      // Joins measured broken here, not merely unoptimised: with joins on,
      // the adapter's relational queries threw ("referencedTable" undefined
      // in drizzle's query builder) on every session lookup, while the same
      // queries run fine through db.query directly. The documented fallback
      // only covers missing relation keys, not this. Sessions are cookie-
      // cached anyway, so the join saves little — revisit on a better-auth
      // or drizzle upgrade (spec: dashboard-auth).
      database: { joins: false },
    },
    // Protects sign-in from credential stuffing. Memory storage is per
    // instance and resets on restart — fine for a single-node self-host.
    // NEVER switch to storage: "database" without remapping the model: under
    // usePlural it would resolve to the widget-guard's rateLimits table,
    // which has a different shape.
    rateLimit: { enabled: true, storage: "memory" },
    hooks: {
      before: closedSignupGate,
    },
    databaseHooks: {
      user: { create: { after: attachFirstUserAsOwner } },
      // Fires for a new provider user and for an existing user linking a
      // provider, never for the email path.
      account: { create: { after: joinFromInvitationOrDomain } },
      session: { create: { before: setActiveOrganization } },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        // Free tier = 1 org (D12); the seeded org is the instance's org and
        // bootstrap attaches to it. Creation/deletion would break the model —
        // deletion would also cascade-drop every project, source and chunk.
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        cancelPendingInvitationsOnReInvite: true,
        // Fires on re-invite too (the plugin refreshes the expiry), so
        // inviting again doubles as resending. Uses the same base URL the
        // docs promise for auth links (spec: invitation-email).
        sendInvitationEmail: async (data) => {
          const url = `${authConfig().baseURL}/accept-invitation/${data.id}`;
          try {
            await sendInvitationEmail({
              email: data.email,
              url,
              role: data.role,
              organizationName: data.organization.name,
              inviterName: data.inviter.user.name ?? null,
              expiresAt: data.invitation.expiresAt ?? null,
            });
          } catch (error) {
            // Creating an invitation must not fail because mail did not go
            // out — the copyable link on the Members page is the fallback.
            console.error(
              "Invitation email was not sent:",
              error instanceof Error ? error.message : error,
            );
          }
        },
      }),
      // Must stay last: rewrites Set-Cookie through next/headers so server
      // actions (sign-in, sign-up) actually set the session cookie.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// Lazy, one instance per process (surviving dev HMR reloads) — same pattern
// as lib/db.ts getDb(). Lazy matters: constructing eagerly would open the DB
// path at module load, which runs during `next build`'s page-data collection
// where no DATABASE_URL exists.
const globalForAuth = globalThis as unknown as { deskbellAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.deskbellAuth ??= createAuth();
  return globalForAuth.deskbellAuth;
}
