# Action presentation in the widget

**Status:** done · **Date:** 2026-09-22 · **Builds on:** `2026-09-22-mcp-actions`

## Problem

The first cut of actions showed the visitor the machinery. A tool named
`ask_wiki_question` appeared as "ask wiki question" in three places on one
answer: a status row saying *Done*, a Sources pill saying *From an action*, and
the audit summary on the confirmation card, argument names included
(`repoName: vercel/ai`). A turn that paused for confirmation left an empty
assistant bubble above the card, and the card's question was *Go ahead?* with
*No, don't* as the way out.

None of that is wrong; all of it is written for the operator. The visitor
should see what is happening in their own words and decide with the same
information the server will act on, and nothing else.

## Design

### One label per tool, chosen by the operator

`action_servers.labels` (jsonb, tool name → string, 60 chars) holds what a tool
is called in the widget. Settings › Actions gets a **Shown to visitors as**
field per tool, placeholder = the derived title, empty = derived. The derived
title is the tool's `title`, then its annotation title, then the name with
separators turned into spaces and the first letter capitalized:
`ask_wiki_question` → *Ask wiki question*. The label is written as what the
tool does for the visitor — *Look up your order*, *Cancel your subscription* —
because the widget prints it with a trailing ellipsis while the tool runs.

`actionVisitorLabel(tool, labels)` in `@deskbell/shared` is the one function
that resolves it; `tools-for-request` uses it, so the label is the `title` on
every event, audit row and citation from then on. Labels are merged like
policies: one field per known tool, unknown tools dropped, saved together.

### Arguments as a list, named by the schema

`actionDetails(input, inputSchema)` in `@deskbell/shared` turns a call's
arguments into `{ label, value }` rows: the label is the schema property's
`title`, else the key split on case and separators with the first letter
capitalized and `id`/`url`/`ip` upper-cased (`repoName` → *Repo name*,
`order_id` → *Order ID*); the value is the scalar as text, an array of scalars
joined with commas, anything else as JSON. Null and undefined are skipped,
values cut at 200 characters, at most 12 rows.

The engine adds `details` to the `confirm` event and to the `approval` report;
the ask route stores them on the `action_calls` row (`details` jsonb) next to
`summary`, which stays as the one-line audit text; the messages route replays
them. The widget renders the list and never sees a key name.

### The widget: steps above, one card, no duplicate

- **Steps strip.** Calls render as a compact line *above* the answer text, in
  the order they happened, because they happened before the answer: a
  spinner and *Label…* while running, a check and *Label* when done, the
  label plus a muted verdict when it failed, was cancelled or expired. The
  status word is present for assistive tech in every state and visible only
  when it carries information.
- **Confirmation card.** One card per pending call, outside the bubble: an
  eyebrow (*Confirm to continue*), the label, the details list, and two
  buttons — *Cancel* (ghost) and *Confirm* (primary). A row with no details
  falls back to the stored summary, so calls recorded before this change
  still render. Once answered, the card becomes a step line.
- **No empty bubble.** A message with no text, not pending and not refused
  renders its steps and cards without a bubble.
- **Sources stay sources.** Citations of kind `action` are not shown as
  pills; the step line already says the tool ran. The Sources block is
  omitted when nothing else is cited. The `actionResult` copy key goes.

Copy keys: `actionConfirmPrompt` and `actionResult` are removed;
`actionConfirmTitle` is added; defaults reworded (*Cancel*, *Cancelled*,
*Couldn't complete*). Parts: `action-card` and `action-details` are added.

## Non-goals

- A verb form per label ("Looking up…") — the ellipsis on the imperative is
  good enough and one field is easier to fill than two.
- Model narration before a card ("I can cancel that for you") — the card is
  self-explanatory; prose costs a model call per pause.
- Localizing labels per widget locale — the label is operator copy like the
  rest of the appearance settings.

## Verify

- `@deskbell/shared`: tests for `actionToolTitle`, `actionVisitorLabel`,
  `actionDetails`, `ActionLabelsSchema`.
- `@deskbell/core`: the confirm event and approval report carry `details`.
- `apps/web`: `mergeLabels` unit tests; `tools-for-request` uses the label.
- `packages/widget-core`: DOM tests for the steps strip, the card with
  details, the summary fallback, the missing bubble, no action pill.
- Browser: `e2e/widget/actions.spec.ts` on the new copy and parts;
  `e2e/settings-actions.spec.ts` saves a label and sees it back.
- Gates: typecheck, lint, tests, build (widget under 40 KB gzip),
  `docs:widget --check`, `docs:openapi --check`, `evals:check` unchanged.
