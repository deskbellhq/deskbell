# dashboard-auth

> Status: shipped · 2026-08-25
> The auth half of the long-referenced `spec: dashboard-shell` (repo-scaffold follow-up #6).
> Closes the "dashboard has no authentication" callouts in `docs/security.mdx` and the
> production checklist, and the `TODO`/comment pointers in `lib/org.ts`, `login-form.tsx`,
> `app-sidebar.tsx` and `deploy/actions.ts`.

## Problem

The dashboard is completely open. Anyone who can reach a deployment can read every
conversation, change the model's sources, edit the widget appearance, and alter the origin
allowlist and token budget — the two controls that protect the operator's LLM spend. The
production checklist currently tells operators to put a VPN or basic-auth proxy in front,
which is an admission, not a control. `better-auth` is a declared dependency (D11) that no
code imports; `/login` renders a form with no handler; `lib/org.ts` resolves every request
to the oldest project row.

## Decisions

1. **Email + password only.** No OAuth providers, no passkeys, no external IdP — sign-in must
   work on a fresh `docker compose up` with Postgres as the only dependency (D11). Password
   hashing is better-auth's scrypt default. SSO stays in `packages/ee` (D03) and is not part
   of this spec.
2. **First signup bootstraps the instance; signup then closes.** The first account created
   becomes `owner` of the instance's organization (the seeded oldest org — the compose
   `migrate` service seeds in production too, so an org always exists; none is ever created
   at signup). Every later account requires a pending invitation for its email; uninvited
   sign-up attempts get a 403. Rationale: the free tier is a single organization (D12), so an
   open signup would mint users that belong to nothing on an internet-reachable instance.
3. **No outbound email in v1.** No verification, no self-serve password reset. Invitations
   surface as a copyable accept-URL in the dashboard; the operator hands the link to the
   invitee out of band. Recovery for a lost owner password is an operator action documented
   in the production checklist (wipe the auth tables → the instance returns to first-run;
   content tables untouched). Email lands later with the SMTP layer; nothing here assumes it.
4. **Roles: owner / admin / editor / viewer (D12)** via the organization plugin with a custom
   access-control statement. v1 enforcement: viewer reads everything, mutates nothing;
   editor mutates sources/appearance/onboarding; admin+ also deploy settings (origin
   allowlist, token budget) and members/invitations. Owner is admin plus nothing yet —
   the distinction is reserved for org deletion/transfer, both disabled in v1.
5. **One organizations table.** The org plugin is pointed at the existing `organizations`
   table (`usePlural` maps model `organization` → schema key `organizations`) rather than
   a parallel table of its own. It needs two more columns (`slug` unique, `logo`); adding
   them costs one migration, while a second org table would cost a translation layer and a
   consistency invariant on every request. `member.organization_id`,
   `invitation.organization_id` and `sessions.active_organization_id` therefore point at the
   same `organizations.id` every tenant-scoped table already FKs (D12).
6. **Auth tables ride the drizzle-kit journal.** Their Drizzle definitions live in
   `packages/db/src/auth-schema.ts` — shape owned by better-auth (field-for-field from the
   installed version, including `accounts.issuer` and its unique `(issuer, account_id)`
   index), migrated by the same `pnpm db:migrate` the compose migrate service runs. They are
   the second documented D12 exception after `rate_limits`: no `org_id` on `users`,
   `sessions`, `accounts`, `verifications` (identity precedes tenancy; `members` carries the
   org link).
7. **The security boundary is the data layer, not middleware.** Every page and server action
   reaches data through `getDefaultProject()`, which now derives the org from the session and
   membership — so a real session check runs on every data path. `proxy.ts` does only an
   optimistic cookie-presence redirect for UX, scoped to dashboard paths; it is not a
   control. The public widget surface (`/api/v1/*`, `/deskbell.js`) is untouched and stays
   guarded by `widget-guard` alone.

## Design

- `apps/web/lib/auth.ts` — the better-auth instance: drizzle adapter (`provider: "pg"`,
  `usePlural`), email+password, cookie-cached sessions, built-in auth rate limiting
  (memory storage — per instance; **never** switch to `"database"` storage without remapping
  the model: under `usePlural` it would resolve to the widget-guard's `rateLimits` table,
  which has a different shape), organization plugin (custom ac/roles, `creatorRole: "owner"`,
  `allowUserToCreateOrganization: false`, `disableOrganizationDeletion: true`),
  `nextCookies()` last. Mounted at `app/api/auth/[...all]/route.ts`.
- `apps/web/lib/auth/hooks.ts` — three hooks wrapping pure, unit-tested decision functions:
  a before-request gate on `/sign-up/email` (first user or invited, else 403); a
  `user.create.after` hook attaching user #1 as owner member of the oldest org; a
  `session.create.before` hook stamping `activeOrganizationId` (authorization comes from the
  `members` row, so stamping before acceptance is safe).
- `apps/web/lib/auth/session.ts` — `getSession` (request-cached), `requireSession`,
  `requireMember`, `requireRole(min)` over a rank order; `lib/org.ts` keeps its name and
  return shape but resolves through `requireMember()`.
- UI: `/login` renders "create the owner account" while zero users exist, the sign-in form
  after; `/accept-invitation/[id]` carries the invited signup/sign-in + accept flow;
  `/members` (admin+) lists members and pending invitations with copyable accept-URLs,
  invites by email+role, revokes, changes roles, removes members. Sidebar shows the real
  session user; log out works.

## Out of scope

Password reset & email verification (SMTP layer) · SSO/SAML/SCIM, custom roles, audit log
(`packages/ee`, D03) · multi-org (D12: EE) · project-level permissions beyond the org roles ·
API keys / server-side callers of `/api/v1/ask` (`docs/security.mdx` already names the
`Authorization: Bearer` branch as the future shape) · RLS (unchanged: scoped helpers).

## Findings from implementation (departures and verified behaviours)

- **Adapter joins are OFF, deliberately.** `advanced.database.joins: true` threw inside
  drizzle's relational query builder (`referencedTable` of undefined) on every session
  lookup, while the identical queries succeed through `db.query` directly — so the
  documented "logs and falls back" safety only covers missing relation keys, not this.
  Sessions are cookie-cached, so the join buys little; revisit on a better-auth or
  drizzle upgrade. The relations in `auth-schema.ts` stand and are correct for direct use.
- **`getActiveMember` throws (`MEMBER_NOT_FOUND`)** when the user has no member row — it
  does not return null. Observed live with a cookie-cached session whose membership had
  been deleted underneath it; `requireMember` catches and redirects.
- **`accounts.issuer` is new in better-auth 1.7** (required, unique with `account_id`) —
  absent from most published guides; taken from the installed model definitions.
- **better-auth's own CSRF check** rejects `/api/auth/*` POSTs without an `Origin`
  header — browsers always send one, scripts must too. Distinct from the widget guard.
- **Page-level denial redirects** (`/members` below admin → Overview) rather than
  throwing; action-level denial still hard-fails. A viewer typing a URL is not an attack.
- The migration's slug backfill was verified against **both** a fresh database and one
  populated pre-auth (multi-row backfill, NOT NULL + unique index applied cleanly).

## Verify (all run 2026-08-25 against a production build + scratch Postgres)

| Check | Result |
|---|---|
| First-run bootstrap | ✅ `/` → 307 `/login` → owner form → signup 200, member row `owner`, session stamped with the org |
| Signup closes | ✅ uninvited `POST /api/auth/sign-up/email` → 403 with the invitation-only message |
| Invitation flow | ✅ invite → accept page renders pre-auth (org + email) → invited signup passes gate → accept → member `viewer`; members page renders the copyable accept URL |
| Role fence | ✅ viewer: no Members nav, `/members` → 307 to Overview; owner: full page. Action-level matrix pinned by unit tests |
| Widget unaffected | ✅ same-origin `GET /config` 200 · `/ask` no-Origin 403 `missing_origin` · third-party+empty-allowlist+prod 403 `unconfigured` · bot UA 403 — the documented guard matrix, no cookies involved |
| Session integrity | ✅ tampered cookie → 307 `/login`; secret rotation invalidates sessions; sign-in rate limit → 429 after 3 failures |
| Recovery path | ✅ auth-table wipe → first-run returns, orgs/projects intact, stale cookie redirects, re-bootstrap works |
| Suite | ✅ typecheck 15/15 · Biome clean · 289 tests green (76 web, 19 new; widget-guard matrix untouched) · build green · docs gate satisfied |
