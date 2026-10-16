# Actions log

**Status:** done · **Date:** 2026-09-22 · **Builds on:** `2026-09-22-mcp-actions`, `2026-09-22-action-presentation`

## Problem

Every tool call is recorded on `action_calls` — input, output, who it ran
for, how it ended, how long it took — and the only way to see a row is to
find the conversation it happened in. An operator who wants to know "which
tool fails", "what did the visitor confirm", "why does the wiki tool take
fourteen seconds" has no page to open. The transcript's call row names the
call but has nowhere to link its outcome to.

## Design

### The page

`/actions` in the main sidebar under Gaps. A table, newest first, capped at
200 rows with a line saying so when the cap is hit. Columns:

- **When** — relative time, absolute on hover.
- **Tool** — the visitor-facing label, the server's name beneath it.
- **Conversation** — the question that led to the call (the message's user
  turn, cut short), linking to the transcript; the visitor's name when the
  call ran for a signed-in visitor.
- **Outcome** — a status chip (Done, Failed, Awaiting confirmation,
  Confirmed, Declined, Expired, Running) and the duration.
- **Details** — opens the drawer.

Filters live in the URL so a view is a link: `period` (7d · 30d · 90d · all,
the gaps page's resolver), `status` (all · done · failed · awaiting · declined
· expired), `server` (a server id) and `tool` (a tool name, meaningful with a
server). Server and tool are selects fed from the project's servers and
their discovered tools; a call whose server was removed still lists under
its stored title and is reachable through "all".

### The drawer

`?call=<id>` opens a drawer on the right (bottom on a phone), like the gaps
detail. It shows: the label and server; status, when, duration; the visitor
(name or "anonymous"); a link to the conversation and to the tool's row in
settings; **Arguments** as the confirmed list when the call has `details`,
else the input as JSON; **Result** as JSON, with a note when the stored
output was cut; **Error** when there is one; for a confirmation, when it was
requested, answered or expired. A call id that does not belong to the
project renders the page without a drawer.

### Export

`/actions/export?period&status&server&tool` downloads the same rows as a
CSV: `id, created_at, server, tool, title, status, latency_ms,
conversation_id, message_id, visitor_id, input, output, output_truncated,
error, responded_at`. Input and output are JSON strings in a cell. Same
cells rule as the gaps export (formula-leading characters quoted).

### Links in

The transcript's call row links its outcome part to `/actions?call=<id>`;
the title keeps linking to the tool's settings row. The command palette
gets an Actions entry.

### Empty states

No server attached: "No actions yet" with a link to Settings › Actions.
Servers but no calls in the period: "No calls in this period" and the
period control stays.

## Non-goals

- Retention or deletion of rows (a later concern with its own decision).
- A `action.failed` notification event: the notifications subsystem takes
  one union member, but it needs a worker builder, a settings toggle and
  docs of its own — a separate unit.
- Eval cases with fixture tools.
- Re-running a call from the log.

## Verify

- `apps/web/lib/actions/log.test.ts`: filter parsing, href building, the
  status vocabulary, CSV rows.
- Browser: `e2e/actions.spec.ts` — the seeded calls list newest first, the
  status filter narrows, the drawer shows arguments and result, the export
  downloads a CSV with the rows, the transcript's call row opens the drawer.
- Gates: typecheck, lint, tests, build, docs tests.
