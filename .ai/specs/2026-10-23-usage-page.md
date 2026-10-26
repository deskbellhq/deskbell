# Usage page

> Status: in progress · 2026-10-23

**Goal.** One dashboard page that says how much the widget is used, by whom in the aggregate, and about what — refreshed on every read, never by hand. The Overview answers "is it working"; Usage answers "who is asking, how often, and what about", split and filtered along whatever dimensions the host page already sends.

## Design

**Context keys are the dimensions.** A conversation stores the context the host page attached at creation (`{ account: { id, name }, site: …, user_type: … }`, up to eight keys the server never interprets). The Usage page turns every key it finds in the period into a control: **split by** a key to see every number per value (a chart series and a card line each), **break down by** a key to get one table row per value, and **filter** on `key=id` pairs. Nothing on the page knows what an account or a user type is; a host that wants to report on a new dimension adds a key to the widget's `context` and the page offers it. Filters are jsonb containment tests, answered by a GIN index on `conversations.context`.

**Every number is a count over visitor questions in the period.** Questions are user messages; conversations are threads with a question in the window; visitors are `count(distinct coalesce(end_user_id, session_id))`, a verified person or an anonymous browser session; returning visitors are those with questions on more than one UTC day. The bounded periods (7, 30, 90 days) also compute the equal-length window before, so cards and topic rows carry a delta.

**Series are capped.** A split with more than six values keeps the largest five and folds the rest into "Other"; conversations without the key are a "No `<key>`" series. The chart stacks one column per day, largest series at the baseline, in the theme's six categorical tokens (`--series-1…6`, validated as a set for colour-vision deficiency in both modes); a weekly roll-up is computed client-side from the same rows. A column opens the Conversations page on that day or week.

**Topics** (spec: question-topics) are a table: one row per label with questions (drawn as a bar scaled to the largest row, stacked per series when split), the share of all questions in the period, the delta, conversations, and a column per series when split. A topic links to the Conversations page filtered to it. Questions not yet labelled are one row at the bottom; a project without topics sees a card pointing at Settings › Topics.

**Drill-down.** The Conversations page learns two filters, `?topic=<key>` and `?ctx.<key>=<id>`, so a number on this page is a door to the threads behind it; the inbox shows them as chips with a way back.

**Visitors.** When the project verifies identity, a table lists every verified visitor who asked in the window, most questions first (capped at the breakdown's hundred rows, the heading saying "first 100 of N" past it) — name, else email, else subject, the same label the thread view shows — with questions, conversations, days active and the last question, each a door to their threads (`?user=<end_users.id>` on the Conversations page, shown as a chip). A visitor who asked on `POWER_USER_DAYS` (three) or more different days wears a *Power user* badge and the heading counts them: days, not questions, so one long afternoon never qualifies. The threshold is a constant until a deployment asks for a setting. It is the one read of `end_users` on the page. An anonymous browser session has no profile and is never listed; the table's heading says how many sessions were counted beside the names. The breakdown names the host's entities (the ids and names the host page attached), never a visitor. The browser test asserts that the seeded visitors are named only in that table, that no session id reaches the page, and that a filter no verified visitor matches names nobody.

**Long lists fold, they do not page.** The visitors table shows ten rows and one button opens the rest (to the hundred-row cap), in the same request; a dashboard table is scanned, not browsed, and a filter is the way to shorten it. **Each table opens with a reading**: one computed sentence naming the leader and what moved most, so the reader is told what the numbers say before reading them.

**Share is a picture before it is a number.** When the page is not split, a composition bar above the Topics table shows the five largest named topics in the series colours and everything else in one muted segment, with a legend of shares; the table's rows carry the matching swatch. When split, the rows already wear the series colours per segment, so the bar steps aside rather than mean two things. A delta is an arrow, the count, and the relative change; a topic with nothing before is "new".

**Every rule is one hover away.** Column heads, the visitors heading and the delta badges carry a tooltip (`components/usage-hint.tsx`) that states the rule in a sentence — what a share is a share of, what makes a power user, what the previous period is — so the page needs no legend.

URL state lives in `lib/usage-view.ts` (import-free, for the client toolbar), the queries in `lib/usage-query.ts`, the shaping in `lib/usage.ts` (pure, tested). Period resolution is the Gaps page's.

## Non-goals

- A CSV export. The numbers are small tables; the Gaps page's export pattern can be reused when someone asks.
- Cohort retention (first-seen week × later weeks). The returning-visitor share answers the question the page is asked; a cohort grid is a page of its own.
- A project switch to hide the visitors table. Members already see every verified visitor's name on their threads, so the table reveals nothing new; a deployment whose rules forbid ranking its own staff by name can ask for the switch, and it is one boolean on the project.
- Certain/uncertain splits per segment. That is the Overview's and the Gaps page's story; mixing answer quality into a usage page makes both harder to read.
- Multi-project views. The dashboard is single-project.

## Open questions

- Whether "conversations in the period" should mean started in the period (the Overview's rule) rather than active in it. Active was chosen so a long thread counts on every day it is used, matching the Conversations page's date range; the two pages' totals therefore differ slightly by design.

## Verify

- Unit: `usage-view.test.ts` (parsing, filters, round-trip), `usage.test.ts` (series pick and fold, zero-fill, weekly roll-up, deltas), `conversations-view.test.ts` (the three new filters).
- Browser: `usage.spec.ts` on seeded conversations with two `user_type` values and three accounts — the headline numbers, the split line, the breakdown rows, the topic counts, the visitor rows and their drill-down, filters held in the URL, the phone layout, and no name outside that table.
