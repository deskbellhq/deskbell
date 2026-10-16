# Gaps export: a spreadsheet for the docs team, a dataset for the harness

> Status: done · 2026-09-10

**Goal.** The gaps page is a screen, and the people who fix documentation
work in spreadsheets and issue trackers. The eval harness, meanwhile, wants
real questions as cases, and today the only bridge is copying one case at
a time. This adds two downloads of the current view: a CSV with one row
per gap cluster, and a dataset file that the harness loads unchanged, with
one case per cluster carrying real-question provenance and a placeholder
marking criterion a person must replace. Both are the page's own rows,
period and order, so what is downloaded is what was on screen.

## Design

**One builder, two consumers.** `lib/gaps-export.ts` builds the eval case
for a group; the page's "Copy as eval case" and the dataset export both
call it, so the two cannot drift. The case id is the normalised label as a
slug plus the tail of the cluster id, because dataset ids must be unique
and two clusters can share a 48-character slug. Unclustered groups get a
short hash of the key instead.

**Dataset.** `{ name, description, cases }` as the harness's parser
expects. Each case: the cluster label as the question, `kind:
"answerable"`, the placeholder fact (the file loads and grades visibly
wrong until someone writes real criteria — that is the point), no
relevant URLs (the evidence URLs are what the engine found or cited, not
what the answer should rest on; they go in `notes` for the person
labelling), tags for the signals the cluster carried (`real-traffic`, then
`refused`, `downvoted`, `weak-answer`, `resolved`), and `source` with the
latest message id and time.

**CSV.** One row per cluster: cluster id, question, status, times,
refused, marked down, weak, times in the previous period, trend, first and
last seen, downvote reasons, sample phrasings, found documents, cited
documents, and the dashboard path of the latest conversation. RFC 4180
quoting; and because questions are visitor-typed text, any field starting
with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe
so a spreadsheet shows it as text rather than evaluating it.

**Route.** `GET /gaps/export?format=csv|dataset&period=…&sort=…` is a
route handler inside the dashboard group: the session check is the same
`getDefaultProject()` the page uses (signed out redirects to login), the
rows come from the same query, the grouping and order from the same
helpers. The response carries `content-disposition: attachment` with a
filename naming the project, period and date, and `cache-control:
no-store`. A download link needs a real URL, which is why this is a route
handler and not a server action.

**Toolbar.** An "Export" menu beside the period and order controls with
the two downloads, carrying the current period and order.

## Non-goals

- Streaming or paging the export. It renders the page's rows; a project
  that outgrows the page outgrows the export at the same time.
- Writing the dataset into the repository from the app. Datasets are
  files in the repository; the download is how one gets there.
- Import. Nothing reads a dataset back into the dashboard.

## Open questions

- Whether the CSV should carry one row per phrasing as well. One per
  cluster matches the page; a "long" form is a flag away if a docs team
  asks for it.

## Verify

- With a session cookie, `curl -I` of the CSV and dataset URLs shows the
  content type, the attachment header and no-store.
- The downloaded dataset loads through the harness (`pnpm evals
  --dataset <file> --project proj_dev --retrieval-only`).
- The CSV opens in a spreadsheet; a question beginning with `=` shows as
  text.
- Unit tests: quoting and the formula guard, the header order, the dataset
  round-trips through the harness's parser, ids stay unique for two
  clusters with the same slug, and the copied case equals the exported one.
