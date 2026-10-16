# Dashboard browser tests: the gaps page, driven end to end

> Status: done · 2026-09-10

**Goal.** Every dashboard change so far has been verified by unit tests over
pure functions plus a manual walk in a browser, which nobody repeats after
the next change. The gaps page now has a period, an order, clusters,
actions, a detail panel and two downloads — enough moving parts that a
regression is likely and a manual walk is expensive. This adds the
repository's first browser tests: a Playwright suite that builds a fresh
database, registers the first user, and walks the gaps page at desktop and
phone width, locally and in CI.

## Design

**A database of its own.** The suite never touches the developer's
database. Its global setup derives `<name>_e2e` from `DATABASE_URL`,
creates it if missing, applies the migrations, seeds the default
workspace, clears every account and session so the first-user bootstrap
applies, and inserts a deterministic set of gap rows: clusters with one
and two phrasings, refused with and without context, a thumbs-down, a weak
answer, a row from before the signal columns existed, a resolved cluster
outside the default period, and one stored analysis. Dates are offsets
from the run's clock, so "last 7 days" means the same thing every time.

**A server of its own.** Playwright starts `next start` on port 3300
against that database with a test auth secret and base URL, from the
build CI already makes; locally it reuses a server already on that port.
No model key is needed: the pages under test embed nothing and call no
model.

**One sign-in, saved.** A setup project registers the first user through
the real form and saves the storage state; the desktop and phone projects
depend on it and start signed in. Each test opens the page fresh.

**What the tests assert.** The page lists the seeded clusters with their
badges and totals; the period switch hides older rows; the order switch
reorders; the detail panel shows the phrasings, the evidence and the
stored analysis; marking a cluster resolved changes its badge and sinks
it; the CSV download has the header row and a quoted question; the
dataset download parses and carries real-question provenance; at phone
width the toolbar is usable and the body never scrolls sideways.

**Selectors** are roles and accessible names — links, buttons, rows,
dialogs, options — so the tests read as the page does and survive
styling changes. Assertions are web-first; no sleeps.

**CI** gets a second job with a pgvector Postgres service. It installs
Chromium, builds the web app, and runs the suite; traces are kept on the
first retry, which is the only retry.

## Non-goals

- Testing the widget endpoints or the worker in the browser. They have
  their own tests; the browser suite is for what only a browser can see.
- Visual regression. Assertions are about content and behaviour.
- Every page. The gaps page is the first; the setup is what other pages
  reuse.

## Open questions

- The web app builds with `output: standalone` for the container image, and
  `next start` warns that it is not meant for that output. It serves the
  suite correctly today; if a Next release makes the warning an error, the
  server command becomes the standalone `server.js` with the static assets
  copied beside it, as the image already does.
- Whether the seed should also be the developer's demo data. It is small
  and deterministic; a `pnpm db:seed --demo` could reuse it. Not until
  someone wants that.

## Verify

- `pnpm e2e` passes locally against a freshly created `deskbell_e2e`.
- The CI job passes on a push.
- Dropping the `_e2e` database and re-running recreates it.
