# Invitation emails

Date: 2026-08-26 · Status: shipped · Amends: 2026-08-25-dashboard-auth ·
Builds on: 2026-08-26-password-reset-email

## Decision

Email the invitation accept link to the invitee whenever outbound email is
configured. The copyable link on the Members page stays, always: delivery is
a convenience layer, the link is the contract.

## Why

The mailer seam exists now; handing links over out of band is friction the
instance can remove for itself. But email is optional configuration and
delivery fails silently (spam, typos, provider outages), so the emailed link
must never become the only path — and invitation creation must never fail
because a mail did not go out.

## Shape

- The org plugin's `sendInvitationEmail` hook builds the accept URL from the
  auth base URL — the same base the docs promise for every auth link — and
  sends through the shared mailer. Errors are logged and swallowed; the
  invitation row is already created and the page link works.
- The hook also fires on re-invite (the plugin refreshes the expiry), so
  inviting the same address again doubles as resending the email.
- Delivery follows the mailer's modes: real SMTP when configured, server
  console in development, nothing in production without SMTP (the log says
  so once per attempt).
- The Members page states which regime it is in: "emailed + copyable link"
  when SMTP is configured, the hand-over sentence otherwise.
- The mail is plain text: inviter, workspace, role, accept URL, expiry.

## Ruled out

- Emails for role changes or member removal: notification noise with no
  action attached; nothing needs them.
- Hiding the copyable link when email is on: delivery is unverifiable from
  the sending side; the admin needs the fallback in hand, not after a
  support round-trip.

## Where it bites

`apps/web/lib/auth/invitation-email.ts`, the org plugin block in
`lib/auth.ts`, the Members page intro copy, and the security /
production-checklist / configuration docs.
