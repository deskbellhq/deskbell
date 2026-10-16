# End-user identity: verified visitors own their conversations

> Status: done · 2026-09-17

**Goal.** Every conversation is owned by a random session id in the visitor's
browser. That is right for a public docs site and wrong the moment the widget
sits inside a product where the visitor is signed in: their history should
follow them to the next browser, a support colleague should be able to say
whose conversation this is, and a page should be able to say which account or
site the question was about. This spec adds verified end-user identity to the
public endpoints without weakening anything the abuse guard does today.

## Design

**Identity is a property of the project.** `projects.identity` holds the OpenID
issuer, an optional audience, and where its signing keys are: a JWKS URL, or an
inline key set for installs that cannot reach the issuer and for tests. Empty
means what it means today: anonymous sessions only. `required` turns anonymous
access off for that project.

**The token rides on every request.** The SDK asks a `getAuthToken` callback
before each call and sends `Authorization: Bearer`. The preflight grants the
header; the guard decides what it means. Verification uses `jose` against the
project's key set, enforcing issuer, audience when configured, expiry with a
small clock tolerance, and the signature. Remote key sets are cached per URL
and refreshed by jose on an unknown key id, so key rotation needs no restart.

**Order in the guard.** Identity is checked after the bot filter, the project
lookup, origin binding and the rate limits, and before the budget and
concurrency checks that only `/ask` runs. A token never buys a way past the
allowlist or the limits; it only says who the caller is. A bad token is a 401
even when anonymous access is allowed, because silently downgrading a broken
integration to "anonymous" hides the break behind a working widget. The 401
carries CORS headers, like the 429, so the widget can tell "sign in" from "the
server is down". The install beacon carries no identity.

**One ownership rule.** `ownedBy(caller)` yields the clause every
visitor-facing read and write uses: a verified user owns the rows carrying
their `end_user_id`, an anonymous caller owns the rows carrying their session.
The two never mix. Soft-deleted rows are nobody's, enforced in the same clause.
Ask, list, messages, feedback, delete and rename all go through it.

**The end user row.** `end_users` is one row per (project, issuer, subject),
upserted on every verified request with the token's email and name, so a
renamed account shows its new name with no migration. A claim the token
omits leaves the stored value alone (2026-10-13): a token minted without
profile claims is not a rename to nothing. Conversations point at
it with `on delete set null`: removing a person leaves their threads anonymous
rather than gone, which is what the gap analytics built on those threads need.

**A staff claim, reserved.** `identity.staffClaim` names a claim path and value
that marks support staff. Stored and validated now; the endpoint that honours
it (reading another person's conversation) is its own spec. Recording the
setting here means the dashboard form is complete once, not twice.

**The dashboard.** Settings › Identity: issuer, key-set URL with a Discover
button that reads the issuer's OpenID configuration server-side, inline key
set, audience, require sign-in, staff claim. Admin-gated like the allowlist.
The thread page shows the verified user in place of the session id.

## Non-goals

- Issuing tokens. Deskbell verifies; the host application's identity provider
  signs.
- Opaque tokens or introspection endpoints. Signed JWTs only.
- Server-to-server callers with a secret key. Still absent; still a separate
  branch in the guard when it lands.
- Migrating an anonymous session's threads to a user who later signs in.

## Open questions

- Whether a project should be able to name several issuers. One is enough for
  every deployment asked for so far.

## Verify

- `verify.test.ts`: a valid token yields subject and profile; wrong issuer,
  wrong audience, expired, foreign key, garbage and a missing subject all throw;
  no key source throws.
- `resolve.test.ts`: not configured, anonymous allowed, anonymous refused, bad
  token refused even when anonymous is allowed, good token verified.
- `conversation-access.test.ts`: the clause binds to the session for anonymous
  callers and to the end user for verified ones, and excludes deleted rows.
- `widget-cors.test.ts`: the preflight grants `authorization`.
- Anonymous projects behave exactly as before; the existing route tests and the
  eval gate are unchanged.

## Widget side (added the same day)

The element takes `getAuthToken` as a property (and `deskbell("auth", fn)`)
and hands it to the SDK client, so every request carries the bearer. A 401 on
ask is retried once with a fresh token before the `unauthorized` copy shows
and `deskbell:unauthorized` fires. The React wrapper forwards the prop to the
property. Nothing token-shaped is ever an attribute.
