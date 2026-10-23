# Usage page

> Status: in progress · 2026-10-23

**Goal.** One dashboard page that says how much the widget is used, by whom in the aggregate, and about what — refreshed on every read, never by hand. The Overview answers "is it working"; Usage answers "who is asking, how often, and what about", split and filtered along whatever dimensions the host page already sends.

## Design

**Context keys are the dimensions.** A conversation stores the context the host page attached at creation (`{ account: { id, name }, site: …, user_type: … }`, up to eight keys the server never interprets). The Usage page turns every key it finds in the period into a control: **split by** a key to see every number per value (a chart series and a card line each), **break down by** a key to get one table row per value, and **filter** on `key=id` pairs. Nothing on the page knows what an account or a user type is; a host that wants to report on a new dimension adds a key to the widget's `context` and the page offers it. Filters are jsonb containment tests, answered by a GIN index on `conversations.context`.

**Every number is a count over visitor questions in the period.** Questions are user messages; conversations are threads with a question in the window; visitors are `count(distinct coalesce(end_user_id, session_id))`, a verified person or an anonymous browser session; returning visitors are those with questions on more than one UTC day. The bounded periods (7, 30, 90 days) also compute the equal-length window before, so cards and topic rows carry a delta.

**Series are capped.** A split with more than six values keeps the largest five and folds the rest into "Other"; conversations without the key are a "No `<key>`" series. The chart stacks one column per day, largest series at the baseline, in the theme's six categorical tokens (`--series-1…6`, validated as a set for colour-vision deficiency in both modes); a weekly roll-up is computed client-side from the same rows. A column opens the Conversations page on that day or week.

**Topics** (spec: question-topics) are a table: one row per label with questions, the delta, conversations, and a column per series when split. A topic links to the Conversations page filtered to it. Questions not yet labelled are one row at the bottom; a project without topics sees a card pointing at Settings › Topics.

**Drill-down.** The Conversations page learns two filters, `?topic=<key>` and `?ctx.<key>=<id>`, so a number on this page is a door to the threads behind it; the inbox shows them as chips with a way back.

**No person is named.** The queries select no column of `end_users`; the breakdown shows the ids and names the host page attached to the conversation, which name the host's entities, not the visitor. The browser test asserts that the seeded visitors' emails and names appear nowhere on the page.

URL state lives in `lib/usage-view.ts` (import-free, for the client toolbar), the queries in `lib/usage-query.ts`, the shaping in `lib/usage.ts` (pure, tested). Period resolution is the Gaps page's.

## Non-goals

- A CSV export. The numbers are small tables; the Gaps page's export pattern can be reused when someone asks.
- Cohort retention (first-seen week × later weeks). The returning-visitor share answers the question the page is asked; a cohort grid is a page of its own.
- Certain/uncertain splits per segment. That is the Overview's and the Gaps page's story; mixing answer quality into a usage page makes both harder to read.
- Multi-project views. The dashboard is single-project.

## Open questions

- Whether "conversations in the period" should mean started in the period (the Overview's rule) rather than active in it. Active was chosen so a long thread counts on every day it is used, matching the Conversations page's date range; the two pages' totals therefore differ slightly by design.

## Verify

- Unit: `usage-view.test.ts` (parsing, filters, round-trip), `usage.test.ts` (series pick and fold, zero-fill, weekly roll-up, deltas), `conversations-view.test.ts` (the two new filters).
- Browser: `usage.spec.ts` on seeded conversations with two `user_type` values and three accounts — the headline numbers, the split line, the breakdown rows, the topic counts, filters held in the URL, the phone layout, and no seeded email or name on the page.
