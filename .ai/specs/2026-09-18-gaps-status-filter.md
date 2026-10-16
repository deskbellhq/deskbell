# Gaps: a status filter, and where resolved gaps go

> Status: done · 2026-09-18

**Goal.** Resolved clusters stayed in the list, sunk to the bottom of every
order. That kept them visible and kept them in the way: the page is the list
of things to do, and a done thing does not belong on it, but a done thing
also needs somewhere to be reviewed, and a gap closed by a written answer
needs to be told apart from one closed by hand. This adds a status filter
to the page, with open as the default, and an "Answered" badge for the
clusters a written answer resolved.

## Design

**Three views, one URL builder.** `status` joins `period` and `sort` in the
query string: `open` (the default, omitted from the URL), `resolved`, or
`all`. A pure `gapsHref` builds every link the page, its toolbar and its
rows emit, leaving defaults out, so two links to the same view are the same
string. The same function carries the drawer's `gap` and `write` parameters
for the change that follows this one.

**Where the filter sits in the pipeline.** Group, attach the trend against
the previous window, then filter by status, then order. Trend is attached
before the filter so a resolved cluster in the combined view still shows
whether it is rising. Status is a property of the cluster, not of the
message, so the previous window is filtered the same way and the totals'
deltas compare like with like: on the resolved view, resolved clusters now
against resolved clusters before. The counts on the status control come from
the unfiltered set of the period, so they say what each click would show.
The export route runs the identical pipeline and appends `-resolved` or
`-all` to the file and dataset names only when the view is not the default,
so the names of existing downloads do not change.

**Answered.** A resolved cluster whose `correction_document_id` is set shows
"Answered" with a pen glyph in place of "Resolved". The two are the same
status with a different cause; nothing else about them differs, and
reopening works the same way.

**Feedback without a toast.** Resolving or answering from the open view
removes the row when the page revalidates. What the operator sees is the
count on the status control moving; a later change keeps the drawer open on
the cluster it was showing.

**Empty states.** The open view with resolved clusters in the period says so
and links to the resolved view. The resolved view says there are none. The
combined view keeps the original copy.

## Non-goals

- A stored preference for the default view. The URL is the state; a
  bookmark is the preference.
- Filtering by outcome (refused, marked down, weak). The badges say it; a
  filter would be a different page.

## Verify

- Unit: `resolveStatus` defaults to open and falls back on garbage;
  `filterByStatus` and `countByStatus` agree on a mixed list; `gapsHref`
  omits defaults and carries the drawer parameters.
- The default view shows open clusters only, with the counts of all three
  views on the control; the combined view at all time lists the resolved
  clusters last, newest first, and an answered one as "Answered".
- Marking a cluster resolved removes it from the open view and moves the
  counts; the resolved view lists it; reopen brings it back.
- A period with resolved clusters and no open ones says so and links to the
  resolved view; a resolved view with nothing in it says so.
- The CSV and dataset for the default view keep their names and contents.
