# Browser tests for the widget

> Status: done · 2026-09-17

**Goal.** The browser suite walks the dashboard and never touches the widget:
no test opens the panel, streams an answer, votes, lists a signed-in
visitor's threads or reads a staff preview, and `widget-core` has no DOM test
at all. Every recent feature (inline mode, Markdown, feedback reasons, the
sidebar, identity, the preview) shipped on typecheck and pure-function tests.
This spec adds two layers: DOM tests that render the real panel against a fake
client, and Playwright specs that load `deskbell.js` from a real server into a
page on a foreign origin.

## Design

**DOM tests, not component mocks.** `packages/widget-core/src/panel.dom.test.tsx`
renders `Panel` with `@testing-library/preact` under happy-dom. The SDK module
is replaced with a class whose methods are spies, so a test scripts what the
server answers (a stream, a 429, a 500 on delete, a 403 on preview) and asserts
what the visitor sees, by role and accessible name. `vitest.config.ts` runs
`*.dom.test.tsx` in a DOM project and everything else in node.

**A real origin for the browser suite.** Specs under `apps/web/e2e/widget/`
intercept `http://127.0.0.1:8765/**` (loopback, as the browser refuses a loopback script from a non-loopback page, yet a different origin from the server) and answer with a small host page that
loads `deskbell.js` from the server under test and places the element by hand.
The browser sends that origin, the seed puts it on the project's allowlist,
and the guard's origin check runs for real. The ask endpoint is stubbed with
SSE frames (no model key in the suite); the list, delete and preview endpoints
are real, against seeded rows. The `widget` and `widget-phone` projects carry
no dashboard session and use a desktop user agent, since the bot filter
refuses headless Chrome's. Chrome's local-network access check refuses a
loopback script from an intercepted page, so those checks are switched off
for the two widget projects through launch flags.

**Identity in the seed.** The seed generates an ES256 key pair, stores the
public half inline in the project's identity settings and writes the private
half to `e2e/.auth/identity-key.json` (gitignored), so a spec can sign a token
for a seeded visitor, an expired one, or a staff one. Two visitors are seeded:
one with two threads (one carrying a site context, for the scope tabs) and one
whose thread the staff preview reads.

**What the page records.** The host page keeps every widget event on
`window.__events`, so a spec asserts the `deskbell:answer` and
`deskbell:preview` payloads rather than only what is on screen. The token is
set on the element after `customElements.whenDefined`, because a queued
`deskbell("auth", fn)` is dropped before the element is live (see below).

## Non-goals

- Visual regression. Screenshots belong to a deployment's own suite.
- Driving a real model. The ask stub is the whole point.

## Open questions

- `deskbell("auth", fn)` before the element mounts is dropped: the element's
  `run()` buffers only open, close, toggle and ask. Worth fixing; not fixed here.

## Verify

- DOM: launcher and Escape; inline mode with and without a slotted header;
  streamed Markdown with a typed citation pill; 429 copy and event; configured
  reasons gate the text field and the send button, then thank; sidebar rows,
  delete with confirmation, optimistic removal and rollback; readonly
  transcript with disabled thumbs and the 403 copy.
- Browser: ask streams and votes at a foreign origin; inline mode fills its
  element and shows a header only when slotted; a signed-in visitor lists,
  scopes and deletes their threads and the deletion survives a reload; an
  expired token yields the sign-in copy; a staff token opens another visitor's
  thread read-only and a plain token is refused. Each at desktop and 400 px.
