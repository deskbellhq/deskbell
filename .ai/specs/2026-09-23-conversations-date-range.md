# 2026-09-23 — Conversations filters by period, and the list is a view of the URL

**Goal**: the inbox can be narrowed to a period from the page itself, not only
by arriving from a chart column (spec: chart-day-drilldown), and what it lists
for a period is the truth, not the slice of a cap.

## Decisions

- **The periods are the Gaps page's**, plus today and a custom range: All
  time · Today · Last 7 days · Last 30 days · Last 90 days · Custom. One
  vocabulary for "how far back" across the dashboard.
- **Two shapes in the URL.** A relative period is `?period=7d` and stays
  relative, so a link to "last 7 days" means that next week too. A custom
  range is `?from=YYYY-MM-DD&to=YYYY-MM-DD`, two fixed days, which is what a
  chart column or a bookmarked week needs. `period` wins when both appear;
  a half or malformed range is ignored, never an error. Defaults are
  omitted from links.
- **Days are the chart's buckets**: UTC calendar days, inclusive. A relative
  period counts calendar days ending today, the way the chart's range toggle
  slices its rows: last 7 days is today and the six before it. (The Gaps
  page's period is a rolling window of hours; the two differ by at most one
  partial day, and the chart is what this page is reached from.)
- **The list is a parallel route slot** (`@list`) rather than a fetch in the
  layout. A layout never sees search params, which is why the previous list
  was fetched unfiltered and narrowed in the browser, and why a period older
  than the newest 200 threads would have listed nothing. The slot is a page:
  it reads the view, and lists and counts server-side with the same
  aggregates the index page uses to pick the thread to open. The shell is
  still one client component around both panes, so the phone swap and the
  scroll container survive navigation.
- **Counts are of the period, uncapped**: what each filter segment would
  list, from a second query over the same aggregates, so the three numbers
  add up to what the period holds even when the rows are capped.
- **The control is a select** in the pane's header. A preset navigates at
  once; Custom opens two native date fields that navigate as soon as both
  hold a day, and the trigger names the view — a preset's label, or the
  days. Native fields, because they are keyboard- and screen-reader-ready
  without a calendar dependency in the dashboard bundle.
- **A chart column links to a custom range of one day**, `from=to=day`.

## Out of scope

- Time-of-day or local-timezone ranges. Everything is UTC calendar days,
  named as such in the docs.
- A range picker with a calendar. If the native fields prove awkward on a
  phone, that is the moment to add one.
