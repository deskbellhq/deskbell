# Docs gaps: the questions the content could not answer

> Status: done · 2026-09-10 · renamed 2026-09-14: the page is called **Gaps** in the
> dashboard and the docs. "Docs" named one source type, the rest of the UI already
> said "gaps", and one word matches Overview, Sources and Conversations. The docs
> URL `/docs-gaps` and this file's name are unchanged.

**Goal.** Every refusal and every thumbs-down is already written to `messages`
— refusals with the documents retrieval found, downvotes with the documents
the answer cited — and nothing reads them. The Overview counts refusals as
"gaps" and links nowhere. This page turns those rows into the operator's
work list: which questions keep going unanswered, how often, what the agent
found instead, and a one-click way to turn a real question into an eval case
so the harness measures the fix. It is the read side of the contract stated
when persistence was built (spec: conversations-page — "citations/refused
are the raw material for Gaps/Top questions").

## Design

**Route.** `apps/web/app/(dashboard)/gaps/page.tsx`, a Server Component,
`force-dynamic`, same shell as Sources: `SiteHeader` + `PageHeader` + a
table. Org- and project-scoped like every read (D12).

**Query.** One statement: assistant messages in this project that were
refused or downvoted, each with the visitor's question (the closest
preceding user message in the same conversation, as a correlated subquery
— one pass, no N+1), its conversation id, the feedback fields, the stored
citations and the timestamp. Grouping happens in code (`lib/gaps.ts`):
questions are normalised — lower-cased, whitespace collapsed, trailing
punctuation dropped — and identical normalised questions become one row
with a count, the refused/downvoted split, first and last seen, the
downvote reasons, and the documents that appeared across the group.
Dev-scale data, no pagination — the same call the Conversations page made,
and it becomes a follow-up together.

**Evidence is two different things.** A refusal stores what retrieval
*found* (the engine's retrieval set, kept exactly so this page could show
it); a downvoted answer stores what the answer *cited*. The column is
labelled per row — "Found" or "Cited" — never blended into one word, because
"the agent found the right page and still refused" and "the agent cited the
wrong page" are different fixes.

**Copy as eval case.** Each row offers the question as an `EvalCase` JSON
skeleton: id from the normalised question, `kind: "answerable"`,
`expectedFacts` holding one placeholder the operator must replace,
`relevantUrls` empty, `source: { kind: "real", messageId, capturedAt }`
pointing at the most recent occurrence. It validates as a dataset case
(the placeholder is a real string, so the file loads; it is also obviously
not a fact, so a run graded against it fails visibly until someone writes
the criteria). This is the honest version of mining questions from traffic:
a person decides what a correct answer must contain; the page only stops
them retyping the question. Nothing writes to the dataset from the app —
datasets are files in the repository.

**Navigation** is three lists that must agree: the sidebar, the command
palette, and the auth proxy's path matcher (a path missing there shows the
dashboard chrome to a signed-out visitor before the real check redirects).
The Overview's "gaps" badge links here.

## Non-goals

- Editing marking criteria in the browser (an annotation surface is its own
  piece of work).
- Clustering near-duplicate questions semantically. Exact normalised
  matches only; a smarter grouping needs a measure of its own.
  Superseded by spec: gap-clusters.
- Pagination, search, live refresh — with the Conversations page's.

## Open questions

- ~~Whether a resolved gap should be dismissible.~~ Settled by
  gaps-status-filter: a resolved gap leaves the default view and the
  Resolved view lists it, so nothing is dismissed and nothing is lost.

## Verify

- With refusals and downvotes seeded through the public routes, the page
  groups repeated questions, splits refused from downvoted, labels evidence
  per row, and links each row to its latest conversation.
- The copied JSON loads through the dataset parser unchanged.
- Signed out, `/gaps` redirects to `/login` before rendering.
- Empty state on a project with no gaps.
- Desktop and ~400px widths.
