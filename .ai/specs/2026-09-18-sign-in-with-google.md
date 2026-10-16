# Sign in with Google

> Status: in progress · 2026-09-18
> Amends: 2026-08-25-dashboard-auth (Decision 1, "email + password only")

**Goal.** Let dashboard members sign in with a Google account, with the
same rules that govern email sign-up, plus one new rule an instance can set:
email domains whose people may join on their own. Email + password stays the
zero-configuration default; Google is off until two environment variables
are set, so a fresh `docker compose up` still needs Postgres and nothing
else. This is a login method, not single sign-on: no identity-provider
enforcement, no provisioning protocol, no per-user policy. Those remain
where `LICENSING.md` places them.

## Design

**Configuration.** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, read by
`readAuthConfig` into `google: { clientId, clientSecret } | null`. One of
the two set is a misconfiguration: logged once, treated as off. The
provider is registered only when both are present; the sign-in and sign-up
pages render the button only then. The OAuth redirect URI to register with
Google is `${BETTER_AUTH_URL}/api/auth/callback/google`.

**One policy for the OAuth path.** better-auth calls `user.validateUserInfo`
before it creates a user, links an account or signs a provider user in. The
handler leaves every non-OAuth method to the existing `closedSignupGate`
(the email path is unchanged) and applies a pure `oauthDecision`:

- the provider must report the email as verified; otherwise `email_not_verified`;
- on `create-user`: admitted when the instance has no users, when a pending
  unexpired invitation names the email, or when the email's domain is in the
  organisation's allowed list; otherwise `signup_closed`;
- on `sign-in` and `link-account` of an existing user: admitted when the
  user already holds a membership, or the domain is allowed when a list is
  set; otherwise `email_domain_not_allowed`.

A rejection makes better-auth redirect to `/login?error=<code>`, which the
sign-in page turns into a sentence. The page also finally explains
`?reason=no-membership`.

**Membership after OAuth.** `databaseHooks.account.create.after`, for any
provider other than the credential one: the oldest pending unexpired
invitation for the email becomes a member row with the invited role and the
invitation is marked accepted; otherwise, when the domain is allowed, a
member row with the `viewer` role. The account hook fires for a new Google
user and for an existing user linking Google, and never for the email path,
so the invitation page's own accept flow is untouched.

**Linking an existing password account.** `account.accountLinking` with
`trustedProviders: ["google"]` and `requireLocalEmailVerified: false`. The
second flag is needed because no local account is email-verified (sign-up
never sent verification mail: invited people were vouched for by an admin),
and better-auth refuses implicit linking to an unverified local user
regardless of the trusted list. The takeover that gate defends against —
registering a password account with someone else's address, then waiting
for them to sign in with Google — cannot happen here, because sign-up is
invitation-only and an invitation fixes the address. The flag is deprecated
upstream; if it goes, an explicit "Link Google" action on the Account page
is the replacement.

**Allowed sign-in domains.** `organizations.allowed_sign_in_domains`, a
JSON array of lower-cased bare hostnames validated by `SignInDomainsSchema`
(at most twenty). Edited on Settings › Members in a section that renders
only when Google is configured; admin-gated like invitations. Read by the
hooks through the single organisation the instance has.

**Pages.** A "Continue with Google" button above the email form on
`/login` and `/register`, through `authClient.signIn.social` with
`callbackURL: "/"` and `errorCallbackURL: "/login"`; Google is asked to show
the account chooser. The browser suite pins both variables empty so a
developer's `.env` cannot change what the pages render.

## Non-goals

- Other providers; single sign-on through an identity provider; SCIM.
- An explicit "Link Google" action on the Account page (the insurance for
  the deprecated flag; not needed while the flag holds).
- A per-domain default role; the default is `viewer`, admins promote.
- Email verification for password accounts.

## Open questions

- Whether to set `emailVerified` on invited password accounts at creation,
  which would make the deprecated linking flag unnecessary.

## Verify

- Config: both variables set, one set (half-configured, off), none.
- Policy matrix: first user; invited; expired invitation; allowed domain;
  denied domain on create; denied domain on sign-in for a user without a
  membership; existing member from a now-removed domain still admitted;
  unverified provider email.
- Domain list: valid hostnames kept lower-cased, junk refused, cap.
- Browser: no Google button when unconfigured; `/login?error=signup_closed`
  renders its sentence; the Members page shows no domains section when
  unconfigured.
- Manual, with real credentials: an invited address signs in with Google
  and lands on `/` with the invited role; an uninvited off-domain address
  lands on `/login?error=signup_closed`; an on-domain address becomes a
  viewer; an existing password user signing in with Google is linked, one
  user row and two account rows.
