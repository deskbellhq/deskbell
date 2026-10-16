# widget-abuse-protection

> Status: in progress · 2026-08-24
> Closes the LAUNCH-BLOCKING item named by root `AGENTS.md` rule 6, the v1 hardening list (D11/D12),
> D12, and the `TODO(spec: widget-abuse-protection)` comments in every `/api/v1/*` route.

## Problem

`/api/v1/*` is six unauthenticated public endpoints. One of them, `/ask`, spends LLM tokens on
every call. Before this spec the only control was an origin check that **fails open** when
`projects.allowed_origins` is empty — the dev default and therefore the default for anyone who
deploys before reading the docs. No rate limits, no spend ceiling, no bot filtering, anywhere.

A public endpoint that triggers LLM calls is a cost-abuse magnet. Nothing may be publicly
deployed — not the product, not the live widget on the marketing site — until this ships.

## Decisions (2026-08-24)

1. **Empty allowlist fails closed in production**, stays open in dev so `/demo` works.
   `DESKBELL_ALLOW_ANY_ORIGIN=true` is the documented escape hatch for embeds across many
   unknown domains.
2. **Request rates come from env** (an operator/infra concern — an operator must be able to cap
   a runaway tenant from outside the app). **Spend is per project in the DB**: the
   `projects.daily_token_budget` column that has existed since the scaffold finally does
   something, and gets a field on the Deploy page.
3. **Bot filtering = rate limits + cheap heuristics.** No third-party CAPTCHA: it would put a
   remote dependency on the answer path, which the self-host bar (D11) does not allow and
   `DESKBELL_ABUSE_PROTECTION_DISABLED` could not compensate for.

## Design

Six checks in one guard, ordered cheapest-first. `/ask` runs all of them; the read endpoints
stop after (3).

| # | Check | Failure |
|---|---|---|
| 1 | Origin ∈ `project.allowed_origins`; empty ⇒ prod deny / dev allow | 403 |
| 2 | POST carries an `Origin` header; the opaque `null` origin is rejected | 403 |
| 3 | `User-Agent` is not a known crawler/scripting client | 403 |
| 4 | Per-IP/min, per-IP/hour, per-project/min windows | 429 + `Retry-After` |
| 5 | Project's tokens used today < `daily_token_budget` (0 = unlimited) | 429 + `Retry-After` |
| 6 | *(ask only)* concurrent streams from this IP ≤ `MAX_CONCURRENT_ASKS` | 429 + `Retry-After` |

429 and 403 responses carry CORS headers whenever the origin itself passed — without them the
browser reports a network error and the widget cannot tell "rate limited" from "server down".

### Storage — Postgres only (D11)

`rate_limits` is a fixed-window counter table. All of a request's buckets are incremented in a
**single** round-trip:

```sql
insert into rate_limits (key, count, expires_at)
select k, 1, e from unnest($1::text[], $2::timestamptz[]) as t(k, e)
on conflict (key) do update set count = rate_limits.count + 1
returning key, count
```

Fixed windows (the window start is in the key) rather than sliding: one statement, no
bookkeeping, and the worst case is a 2× burst across a boundary — acceptable for a spend guard.
Expired rows are pruned by an hourly `maintenance.prune` pg-boss job, never on the request path.

### IP handling

`clientIp()` reads `x-forwarded-for` **right-to-left**, skipping `DESKBELL_TRUSTED_PROXIES`
hops (default 0 → the rightmost entry, which is the peer Next itself appends), then falls back
to `x-real-ip`. Left-to-right would read the first, attacker-controlled entry.

Raw IPs are never stored. Buckets key on `hmac-sha256(ip, DESKBELL_IP_SALT ?? BETTER_AUTH_SECRET)`
truncated to 16 bytes — PII discipline (D12) and it keeps the table free of tenant data.

### Concurrency

An in-process `Map<ipHash, count>`, not a DB row: it guards stream fan-out inside one Node
process, where the count actually lives. Per-instance by design — across replicas the per-IP
rate limit is what holds. Documented in `apps/docs/content/docs/security.mdx`.

### Token accounting

`token_usage` (`org_id`, `project_id`, `day`, input/output/embedding tokens, unique on
`(project_id, day)`) is upserted after each stream closes, and read before the next one starts.
A single request can therefore overshoot the budget by one answer. Deliberate: the alternative
is holding a reservation across an LLM call, which means reconciling every abort and crash for
a guard whose job is to stop runaway *volume*, not to bill.

Usage reaches the route through plain callbacks so the engine stays transport-neutral (D10):
`EngineDeps.embed` returns `{ embedding, tokens }`, `EngineDeps.generate` takes `onUsage` fed
from AI SDK v7's `streamText(...).totalUsage`, and `AskInput` carries an optional `onUsage`.
Token counts never enter `AnswerEvent` — that type ships to browsers, and visitors must not see
what a site spends.

## Deliberate exception

`rate_limits` has **no `org_id`**, which root `AGENTS.md` rule 3 (D12) forbids. It holds no
tenant data: keys are salted hashes, and the per-IP buckets are cross-tenant by nature — an
abuser hitting five projects is one bucket. It is an operational table in the same category as
pg-boss's own, and is documented as such in the migration. Recorded here rather than buried
because the rule says violations are bugs.

## Fixed in passing

`GET /api/v1/config` returned 403 whenever an allowlist existed and the request had no `Origin`
header — but browsers omit `Origin` on **same-origin** GETs. Any self-hoster serving the widget
from the same domain as the API (our own `/demo` included) broke the moment they locked down
origins. A no-Origin GET cannot be read cross-origin anyway, so it is allowed. POST endpoints
still require Origin (check 2); browsers always send it there.

## Configuration

```
DESKBELL_ALLOW_ANY_ORIGIN=false
DESKBELL_ABUSE_PROTECTION_DISABLED=false
DESKBELL_RATE_LIMIT_ASK_PER_MIN=10
DESKBELL_RATE_LIMIT_ASK_PER_HOUR=100
DESKBELL_RATE_LIMIT_PROJECT_PER_MIN=120
DESKBELL_RATE_LIMIT_READ_PER_MIN=60
DESKBELL_MAX_CONCURRENT_ASKS=2
DESKBELL_TRUSTED_PROXIES=0
DESKBELL_IP_SALT=
```

## Known limits / follow-ups

- **No server-side caller path.** Requiring `Origin` on POST blocks non-browser use of `/ask`.
  There is no secret-key concept yet; when one lands the guard needs one
  `Authorization: Bearer sk_…` branch, before check 2.
- **Fixed windows** allow a 2× burst across a boundary.
- **Concurrency is per-instance** (see above).
- **Budget overshoot** by at most one answer (see above).
- Answer caching (the next v1 hardening item) is the next cost lever and reuses this plumbing.

## Addendum — the deployment's own origin (2026-08-24, same day)

Review of the merge found that the guard fenced the operator out of their
own instance. Reproduced against a production build before changing
anything, and it was worse than first thought:

| | before | after |
|---|---|---|
| empty allowlist, prod: dashboard `POST /ask` | 403 | 200 |
| empty allowlist, prod: dashboard `GET /config` | 403 | 200 |
| **allowlist = customer's site: dashboard `POST /ask`** | **403** | **200** |

The third row is why this was not a first-run bug. Configuring the allowlist
correctly did not fix it — the dashboard's origin is not the customer's site, so
the dogfooded widget stayed broken in every production self-host, permanently.
The visible symptoms were an onboarding checklist whose "ask it something" step
could never complete, and an Appearance page where saved config silently failed
to load while live edits still rendered — a save that looked broken but wasn't.

`checkOrigin` now allows same-origin requests before consulting the allowlist:
a no-Origin GET, or an Origin matching this deployment (request host, plus
`DESKBELL_PUBLIC_URL` when set). Derivation is shared with the Deploy page via
`selfOrigins()` in lib/base-url.ts, so the exempt origin and the displayed one
cannot drift apart.

**Not a weakening.** A browser cannot forge `Origin`; a script never had to,
since it can already claim any allowlisted origin. Origin binding is a browser
control and always was — rate limits and the token budget are what stop scripts.
The exemption is shown as a locked row in the Deploy allowlist rather than left
implicit: an invisible trust rule is the kind that surprises someone during a
security review.

Third-party origins, `Origin: null`, and the production `unconfigured` deny are
unchanged, and pinned by tests.

### Addendum 2 — match on host, not origin (2026-08-24)

The same session that found the first hole then asked what happens behind a
TLS-terminating proxy that forwards `Host` but not `X-Forwarded-Proto`. Real,
and the first attempt at a fix was wrong in an instructive way.

The obvious reading is that `x-forwarded-proto` is *absent*, so the fix is to
treat the scheme as unknown and accept both. Built that, and it changed nothing —
because the header is never absent. **Next populates `x-forwarded-proto` itself,
from its own socket**, verified by echoing the request headers back from a route
handler: a request sent with no `x-forwarded-proto` arrives carrying `http`. The
both-schemes branch was dead code, and the deployment still 403'd its own
dashboard.

So the exemption matches on **host** and ignores the scheme. We cannot learn the
browser's scheme, and pretending otherwise re-creates the original bug on an
ordinary nginx config — allowlist innocent, operator locked out, no setting that
helps. Dropping the scheme costs nothing: exploiting it means serving the same
host over the other scheme, which requires already controlling the deployment or
the network path to it.

Pinned: a lookalike host (`deskbell.acme.example.evil.test`) does not match, a
malformed Origin is simply not us, and Host casing is normalised. Re-verified
over HTTP against a production build — third-party, lookalike, `Origin: null`
and no-Origin all still 403.

Also worth keeping: the peer pinned the *ordering* of the same-origin GET return
(`09419b9`). The original test configured an allowlist, so it passed whether the
return sat above or inside the allowlist block; only an empty allowlist in
production distinguishes them. Verified by injecting the regression — that new
test is the only one of the eighteen that goes red.
