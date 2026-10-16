# Password reset via outbound email

Date: 2026-08-26 · Status: shipped · Amends: 2026-08-25-dashboard-auth,
2026-08-26-register-login-pages (supersedes its no-forgot-password rationale)

## Decision

Add self-serve password reset, delivered by email. Outbound email becomes an
OPTIONAL capability configured by `SMTP_URL` + `EMAIL_FROM`; Postgres remains
the only required infrastructure and every email-powered flow degrades
honestly when mail is off.

## Why

Without outbound email there is no secure self-serve reset — showing the
reset link to whoever typed the email address is account takeover, and the
2026-08-25 answer (operator deletes the auth tables) resets the whole
instance to recover one account. Email is the standard proof of mailbox
control, and SMTP is the one interface every provider and every local dev
catcher speaks, so the integration is a URL, not a vendor SDK — the same
interface-vs-default split the model and vector-store seams use.

## Shape

- `lib/email/`: config reader (`SMTP_URL`, `EMAIL_FROM`; both or neither) and
  a plain-text mailer over nodemailer. Delivery mode is explicit: `smtp` when
  configured, `console` in development without SMTP (links print to the
  server log), `disabled` in production without SMTP — the mailer throws
  there rather than pretending to send.
- better-auth `sendResetPassword` builds its own landing URL
  (`/reset-password?token=…` — no `/api/auth` redirect hop) and swallows
  mailer errors after logging, because the route must answer identically
  whether or not the account exists; the reset URL is a credential and is
  never logged. `revokeSessionsOnPasswordReset` is on: a reset is
  account-takeover recovery, so it ends existing sessions.
- `/forgot-password`: email form → always the same "if that account exists"
  answer (better-auth also rate limits the route, 3/min/IP, and pads the
  missing-account path against timing). When mail is `disabled` the page
  explains the situation instead of rendering a form that cannot work.
- `/reset-password`: reads the token from the query, one password field,
  errors map to "invalid or expired — request a new one", success redirects
  to `/login?reset=1` which shows a confirmation above the sign-in form.
- `/login` gains "Forgot password?" next to the password label.
- Tokens ride better-auth's `verifications` table — no schema change, no
  migration. Expiry is the plugin default (one hour), stated in the email.

## Ruled out

- A provider SDK (Postmark, SES, …): SMTP covers them all; a SDK would bind
  the self-host path to one vendor for zero capability.
- HTML email: these are single-link notifications; text renders everywhere
  and dodges the template + spam-scoring tax.
- Invitation emails: invitations stay copyable links for now — the mailer
  seam makes sending them a follow-up, not a prerequisite.
- Admin-issued reset links (the no-SMTP alternative): once real delivery
  exists it is redundant surface with token-handling risk.

## Where it bites

`apps/web/lib/email/`, `lib/auth.ts` (`emailAndPassword`),
`lib/auth/reset-password-email.ts`, `app/forgot-password/`,
`app/reset-password/`, the login form, `docker-compose.yml`, `.env.example`,
and the security / production-checklist / configuration docs.
