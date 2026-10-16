# Docs gaps: a period, a trend, and an order that surfaces what is new

> Status: in progress · 2026-09-10

**Goal.** The gaps page lists every gap ever recorded, ordered by how often
it was asked. That order buries the thing an operator most needs to see: a
question refused for the first time today ranks under a question refused
twice a month ago, and the page gives no way to ask "what changed since I
fixed the docs last week". This adds a period (7, 30, 90 days, or all
time), a comparison with the period before it so each gap carries a trend,
totals for the period with their deltas, and a default order that weights
recency, so a gap from today is at the top and a stale pair is not.

## Design

**Period** comes from the URL (`?period=7d|30d|90d|all`, default `30d`) so
a view is a link someone can send. The page reads `searchParams`, resolves
the period into a window, and loads two sets of rows: the window, and the
window of equal length before it. Anything unrecognised falls back to the
default rather than erroring. `all` has no previous window and no trend.

**Trend** per group: *new* when the question was not seen in the previous
window; *up* or *down* when the count moved by a quarter or more; *flat*
otherwise. "New" is relative to the previous window, not to all history: a
question last seen three months ago that returns today is new again, which
is the right reading for someone maintaining content.

**Order** is `?sort=recent|frequent|trending`, default `recent`:

- `recent` weights every occurrence by its age with a seven-day half-life
  and sums the weights per group: one occurrence today counts 1.0, two
  from seventeen days ago together count about 0.37, two from yesterday
  about 1.8. A burst still wins; a stale pair does not. Ties break on count,
  then on the most recent occurrence.
- `frequent` is the previous behaviour: count, then most recent.
- `trending` orders by the change against the previous window, then count.

The comparator takes `now` as an argument so the order is a pure function
of the rows and tests do not depend on the clock.

**Totals** for the period sit above the table: gaps (groups), refusals,
marked-down answers and weak answers, each with the delta against the
previous window. The Overview's gap count now means the same thing as the
first of these at the default period: gap groups with activity in the last
30 days, not raw refusals since the beginning of time, so the two numbers
agree.

**Query** moves out of the page into `lib/gaps-query.ts` so the Overview
and the page (and the exports that follow) run one definition. It is the
same statement bounded by `messages.created_at`, served by the indexes the
answer-signal migration added. Grouping takes the group key as a function
so a later grouping can change the key without touching the aggregation.

**Toolbar.** Period as links styled as a segmented control, sort as a
select that rewrites the URL keeping the period. Both live in the page
header's actions slot. On a narrow screen the segmented control wraps.

## Non-goals

- Pagination and search. The period bounds the rows; a very busy project
  will need pagination with the Conversations page's.
- Semantic grouping. The key seam is here; the grouping is its own spec.
- Charts. The totals row is numbers with deltas; a sparkline would be a
  second data series per group with nothing measured to justify it yet.

## Open questions

- Whether the half-life should be a knob. Seven days matches how often
  docs get edited; nothing measured says otherwise, so it stays a constant
  until a real project's traffic argues for another value.

## Verify

- `?period=7d` on the development database shows only today's gap;
  `?period=all` shows all 34 groups; the default view puts today's gap
  first and `?sort=frequent` reproduces the old order.
- The Overview's gap count equals the group count on `/gaps?period=30d`.
- A malformed period or sort falls back to the defaults.
- Totals and deltas are consistent with the table.
- The page renders at desktop and about 400 px wide.
