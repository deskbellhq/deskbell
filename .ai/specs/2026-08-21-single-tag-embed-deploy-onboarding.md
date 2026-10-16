# 2026-08-21 — Single-tag embed, Deploy page, first-run onboarding

> **Note (2026-08-22):** `/widget.js` below is the filename as written on the day;
> it was renamed to `/deskbell.js` the next morning — see the last Decision for the
> rationale. Everything else in this spec is unchanged.

**Goal**: a customer goes from fresh dashboard to widget live on their own site with
zero friction. Three pieces: (1) the embed becomes one script tag —
`<script async src="https://YOUR_DESKBELL/widget.js" data-project-key="pk_…">` — with
the loader deriving `api-url` from its own `src` origin; (2) the Deploy page (the
dashboard-shell IA row "widget embed snippet, keys, origin allowlist") renders the
snippet pre-filled, shows the public key, edits the origin allowlist, and verifies the
install automatically; (3) a first-run checklist on the Overview drives to the
activation event: the first widget ping from a non-dashboard origin.

## Reference

The category convention for embedded widgets is one mutable script URL plus a public
workspace or project id, with server-side origin allowlisting as the whole security
boundary (surveyed 2026-08-21). Hosted vendors serve the script from a CDN whose origin
differs from their API, so their customers configure ids by hand. Self-hosted Deskbell
serves `/widget.js` from the same origin as the API, so the script tag alone carries
everything — a structural advantage of self-hosting, not a cleverness. The
install-verification pattern ("listening for your widget…" → verified) is standard for
analytics products, driven here by a widget mount beacon.

## Decisions

- **Loader auto-mount** (`widget-snippet`): `document.currentScript` captured
  synchronously at module top level (null after the first `await`); `data-project-key`
  present → after `register()`, inject `<deskbell-widget project-key api-url>` at end
  of `<body>`, deferred to DOMContentLoaded when still parsing. Guard:
  `document.querySelector("deskbell-widget")` — a manual element anywhere wins, double
  inclusion is idempotent, and the dashboard dogfood (`<Script>` without
  `data-project-key`) never enters auto-mount. `api-url` = `new URL(script.src).origin`.
- **Full data-* passthrough** (joint decision with spec: widget-customization, same
  day): auto-mount forwards every `data-{attr}` matching `WIDGET_OPTIONS` onto the
  element — the tag's attribute surface IS the element's, generated from the same
  descriptor so they can't drift. An explicit `data-api-url` overrides the derived
  origin (proxy setups). The loader also installs the `window.deskbell` dispatcher and
  replays the pre-load stub queue (`window.deskbell.q`) through widget-core's
  `command()` — the cal.com pattern owned by spec: widget-js-api, wired here to keep
  the two changes from colliding in one 60-line file.
- **The pre-load queue path needs a unit test, never a manual check** (lesson,
  2026-08-21): the loader's first cut read the stub with a `typeof === "function"`
  test — which matches the stub and the live dispatcher alike — so every pre-ready
  call was silently dropped, while auto-mount, passthrough, and *live*
  `deskbell("open")` all passed in the browser. A live-dispatcher call passing tells
  you nothing about the queued path; the queue is the sole reason the stub exists.
  Fixed by extracting DOM-free `readQueue()` (widget-snippet/src/queue.ts, under
  vitest) and buffering commands in widget-core until the panel is live.
- **Install beacon**: the widget fires one `POST /api/v1/ping` `{projectKey}` per tab
  session on mount (sessionStorage guard, errors swallowed). The endpoint upserts
  `widget_installs` (org, project, canonical origin, first/last seen) — **diagnostic,
  not authorization**; it records non-allowlisted origins on purpose so the Deploy page
  can say "widget seen on X — not in your allowlist" (capped at 100 distinct origins
  per project against junk). Same abuse-protection TODO posture as `/api/v1/feedback`.
- **Origin normalization**: allowlist entries are stored as canonical Web origins via
  `URL.origin` (lowercased host, default port stripped) so they match the browser
  `Origin` header byte-for-byte — `widget-cors.ts` compares with strict `includes()`.
- **Base URL for snippets**: new optional env `DESKBELL_PUBLIC_URL`; fallback derives
  from `x-forwarded-proto`/`x-forwarded-host`/`host`. Snippet rendering only — the
  widget itself never needs it (script.src wins).
- **Fail-open stays fail-open.** Empty allowlist still answers any origin: it is the
  documented dev default that makes `pnpm dx` → first answer work with zero config, and
  the enforcement flip is one of three controls (origins, rate limits/budgets, bot
  filtering) that ship together in spec: widget-abuse-protection. This spec ships the
  operable prerequisite (allowlist UI) and makes the posture loud: the Deploy page
  shows a destructive warning whenever the allowlist is empty.
- **Onboarding checklist** (Overview, above the stat cards): three steps — add a docs
  source, ask it something (opens the dogfooded widget via `deskbell:open`), put it on
  your site (Deploy page + listening state). All completion state is **derived from
  real rows** (sources.status, assistant messages, widget_installs with origin ≠ the
  deployment's own); the only stored bit is `projects.onboardingDismissedAt`.
  Dismissable at any point; completion swaps to a success state naming the first
  foreign origin. Live updates via a client `router.refresh()` interval mounted only
  while a step is pending — no websockets.
  *Superseded (2026-09-14):* the compact card became a full-page guide and the Deploy
  page was renamed Install (`/settings/deploy` is gone, not redirected) — see
  spec: overview-getting-started.
- **`/widget.js` route unchanged**: classic script tags need no CORS; `currentScript`
  works for async and injected scripts; prod `max-age=300` bounds rollout lag at 5 min.
- **Renamed to `/deskbell.js`** (2026-08-22): the filename is the one thing a
  reader of a customer's page source sees — `widget.js` is anonymous, `deskbell.js`
  self-identifies, and every page-source sighting is a distribution surface.
  Renamed end to end (route, bundle, exports, snippets, docs) with no alias: zero
  deployments existed, so this was the last free moment to change the URL.
- **Install verification must not be beacon-only** (2026-08-24, from an SDK audit). `widget_installs` used to be written from
  exactly one place — the `/api/v1/ping` beacon in `widget-core/src/panel.tsx`, inside
  the Panel component. So a customer who renders their own UI on `@deskbell/sdk`
  (legitimate: MIT, and D10 makes the engine transport-neutral) asks real questions,
  gets real answers, accumulates conversations and analytics — and Deploy reports
  "Not installed yet" with no allowlist set, or badges their origin **"Pending
  install"** with one set. The second is the worse half: it names an origin we are
  actively serving and calls it pending. Either way it is a silent false negative on
  the one screen whose entire job is answering "did it work?". `/api/v1/ask` now
  records the install too — a question answered IS an install, whatever rendered it —
  under four constraints:
  - **One shared `recordInstall()`** (`lib/installs.ts`), not a second upsert. The
    `MAX_ORIGINS` cap and `normalizeOrigin()` are the abuse boundary for a public
    unauthenticated write; duplicating them is how one copy drifts open.
  - **Never on the hot path**: call it from `after()` (`next/server`, stable in the
    Next 16 already installed). `/api/v1/ask` streams LLM tokens and already awaits
    three DB round trips before the stream opens (project, conversation, user
    message); a diagnostic write must not buy itself a place in time-to-first-token.
  - **No `source` column.** Deploy asks a binary question and both signals answer it.
    What that gives up is distinguishing "loaded, nobody asked yet" (ping-only) from
    "asked from a client we can't see" (ask-only) — real, but it earns a migration and
    new UI states only once something actually renders the distinction.
  - **The residual is server-side clients, and the page must stop over-claiming.** A
    Node SDK caller sends no `Origin`, so origin-keyed verification can never see it —
    this narrows the false negative to headless-on-a-server, it does not close it.
    `lib/onboarding.ts` already derives `asked` from assistant messages, so the
    honest state for "answering questions, zero install rows" is *"answering
    questions — we can't tell from where"*, not "Not installed yet". Verification is
    also the strongest argument on file for a first-class headless client: build your
    own UI and our own dashboard quietly tells you nothing is installed.

  The table's meaning changed with it: the `widget_installs` docblock
  (`packages/db/src/schema.ts`), `install-status.tsx`, and the Deploy section's own
  "the widget pings home on load" copy all described it as what the beacon pinged, and
  were corrected in the same commit.
- **We cannot observe the browser's scheme, so stop comparing it** (2026-08-24). The
  "Base URL for snippets" decision above assumed `x-forwarded-proto` reports what the
  visitor used. It does not: Next always populates that header, from its own socket
  when the proxy sent none, so `http` means "nobody told us". Behind a TLS-terminating
  proxy that forwards `Host` but not `X-Forwarded-Proto` — an ordinary nginx config —
  every derived origin was `http://…` while the browser was on `https://…`. Three
  separate failures, one root cause, all silent:
  - The Deploy page rendered the snippet as `http://host/deskbell.js`, which every
    customer's https page then refuses as mixed content. The one artefact whose entire
    job is to be copied, broken for everyone who copies it.
  - `widget_installs` rows carry the browser's real `https://host`, so an origin
    comparison against the derived `http://host` missed, and the dashboard's own
    dogfood install counted as **foreign**. That marks "put it on your site" complete
    and names the operator's own dashboard as the site it went live on — the exact
    false positive mirroring the false negative fixed earlier the same day.
  - The same miss made the operator's own dashboard show as a stray install on Deploy:
    "widget seen on X — not in your allowlist", about themselves.

  So: comparisons match on **host** via `selfHosts()`, shared with the abuse guard so
  the two cannot disagree about what counts as us. Only rendering needs a whole URL,
  and there the scheme is a guess chosen by which way it hurts — `https` for any
  non-loopback host, because guessing http breaks the snippet for every https customer
  while guessing https only reaches customers whose own pages are plaintext and so
  could not embed it anyway. `DESKBELL_PUBLIC_URL` remains the explicit override.

## Out of scope

Fail-closed enforcement, rate limits, token budgets, bot filtering
(spec: widget-abuse-protection). Open-with-prefill for the "Ask it something" step
(needs a payload on `deskbell:open` — spec: widget-js-api). Per-visitor install
analytics. Marketing-site copy beyond the snippet fix (landed separately in
deskbell-www).
