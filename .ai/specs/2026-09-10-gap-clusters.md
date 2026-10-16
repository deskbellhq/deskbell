# Gap clusters: one row per need, however it was phrased

> Status: done · 2026-09-10 · Amended 2026-09-22 by
> `2026-09-22-gap-cluster-members-and-ignored-terms`: assignment compares a new
> phrasing with every phrasing of the project, not with cluster leaders; the
> question is embedded with the project's ignored names removed; the leader
> vector moved to `gap_phrasings`.

**Goal.** The gaps page groups questions by their normalised text, so "how do
I set up SSO", "sso setup" and "configure single sign-on" are three rows
with a count of one each, and the question behind them — the one worth a
page in the docs — never shows as the most asked. This groups gap questions
by meaning instead: each gap message is assigned to a *cluster* using the
embedding model the project already runs, clusters persist so the page is a
read and not a computation, a cluster can be marked resolved and reopens by
itself when the question comes back, and the whole thing degrades to the
old text grouping when embeddings are unavailable. It supersedes the
"exact normalised matches only" non-goal in spec docs-gaps-page.

## Design

**A cluster is a row.** `gap_clusters` carries the org and project, a label
(the first phrasing seen), the normalised key of that phrasing, the leader
embedding (nullable), the embedding model and version it was made with,
first and last seen, and a status: `open` or `resolved` with who resolved
it and when, plus when it last reopened. `messages.gap_cluster_id` points
the assistant message — the gap row, where feedback lands and where the
page anchors — at its cluster. Only leaders carry vectors: a question is
about fifteen tokens to embed, so re-clustering a project re-embeds
everything for a fraction of a cent, and a six-kilobyte vector on every
message row would buy nothing at that price.

**Assignment is incremental and cheap first.** A worker job takes one
message:

1. If it already has a cluster, stop.
2. Normalise the question. If a cluster in the project has that key, join
   it — no embedding call.
3. Otherwise embed the question and find the nearest leader by cosine in
   the same org, project and embedding model. Join it if the similarity
   clears `DESKBELL_GAPS_CLUSTER_SIMILARITY`.
4. Otherwise create a cluster with this question as label and leader. The
   unique key on (project, normalised key) makes a racing duplicate a no-op
   and the loser re-reads.
5. Attach the message, advance the cluster's first and last seen, and if
   the cluster was resolved before this occurrence, set it open again and
   stamp when.

An embedding failure (network, quota) is not an assignment failure: the
message still gets a cluster by key, created without a leader, and a later
pass gives leaderless clusters their vector. What the worker cannot survive
is an embedding model that is not configured at all; that is already true
of ingestion and stays true.

**Two producers, one safety net.** The ask route enqueues an assignment
after it persists a gap row; the feedback route enqueues one when a
thumbs-down lands on an unassigned answer. Neither is allowed to fail the
request. An hourly catch-up job assigns every gap-qualifying message that
still has no cluster, oldest first so the earliest phrasing becomes the
label, embedding each slice in one batch; it is also what a re-cluster
runs. `scripts/cluster-gaps.ts` runs the same pass from the command line
for one project, the way the re-index has a CLI twin.

**Leaders are compared exactly.** The nearest-leader query orders by
`<=>` over the project's clusters with no approximate index. Clusters per
project number in the hundreds to low thousands, and an exact scan under
the tenant filter avoids the approximate-scan problem the retrieval
defaults spec measured. An index is added when a measurement says the
query is slow, not before.

**The threshold is a property of the embedding model.** `scripts/measure-
gap-clusters.ts` embeds every gap question in a project (and, optionally,
a question set), lists every pair above a low floor with its similarity,
and shows the clusters that would form at several thresholds, so a person
can label the ambiguous band and pick the highest threshold that merges
paraphrases without merging different needs. The default is recorded in
Measurements with the model it was measured on. A different embedding
model moves the scale; the dashboard shows a notice when any cluster's
model differs from the configured one, with a re-cluster action beside it.

**Page.** Rows group by cluster id, falling back to the normalised key for
unassigned rows, so the aggregation is unchanged and only the key moved.
The row shows the cluster label, how many distinct phrasings it holds, its
status, and "recurring" when it reopened inside the period. Resolved
clusters sink to the bottom of whatever order is chosen. Resolve and
reopen are one-click actions for editors; re-cluster (drop every cluster
in the project and rebuild from the rows, losing resolved state) is an
admin action behind a confirmation. While rows are still unassigned the
page says so and refreshes itself.

**Overview.** The gap count becomes open clusters with activity in the
last 30 days, and the card says "open gaps".

**Re-cluster loses resolved state on purpose.** A resolved cluster is a
statement about a set of questions; rebuilt clusters are a different set.
Carrying the flag across would resolve questions nobody looked at.

## Non-goals

- Coordinating cluster creation across several worker replicas. Two
  replicas racing on two *different* phrasings of one new need can create
  two clusters; the next re-cluster merges them. Documented, not solved.
- Splitting a cluster, merging two, or renaming one by hand. Each is a
  small feature with its own interaction; re-cluster is the blunt tool.
- A per-message embedding store. See above: leaders only.

## Open questions

- Whether the label should follow the most frequent phrasing rather than
  the first. First is stable and cheap; most frequent reads better on a
  busy cluster. Not decided until a real project's clusters can be read.

## Verify

- After a re-cluster on the development database every gap row has a
  cluster, the oldest phrasing is the label, and paraphrases (measured
  pairs in the script's output) share a cluster.
- A paraphrase of an existing gap sent through the widget endpoint joins
  that cluster by embedding, and the worker log says so.
- Resolve a cluster, ask its question again: status is open again, with a
  reopened timestamp; the page marks it recurring.
- Stopping the embedding provider (a bad key) still assigns by key and
  creates leaderless clusters; restoring it lets the catch-up pass heal
  them.
- Tests: the assignment paths with fake dependencies; the catch-up order
  and slicing; the page grouping by cluster key with the text fallback.

## Measurements

**Similarity threshold, 2026-09-10.** `scripts/measure-gap-clusters.ts` over
the development project's 36 distinct gap questions plus the 99 questions of
the private tuning set, embedded with `openai/text-embedding-3-small`. Every
pair at or above 0.60, labelled by reading them:

| similarity | pair | same need? |
|---|---|---|
| 0.906 | How do I embed the widget? / How do I embed the widget on my site? | yes |
| 0.837 | how do i configure a site? / how do i set up a site? | yes |
| 0.729 | What is the only infrastructure dependency? / …dependency Deskbell needs? | yes |
| 0.711 | How do I install Deskbell? / What is the only infrastructure dependency Deskbell needs? | no |
| 0.693 | two questions about the same environmental-claims rules | no |
| 0.663 | two more about those rules | no |
| 0.618 | What templating language do the text template blocks use? / Which blocks accept that syntax? | no |
| 0.601 | What does a data source cost per month? / What does it cost per SKU per month? | no |

**Default: 0.80.** It merges two of the three same-need pairs and none of
the different-need ones, with a margin of about 0.07 above the closest
wrong merge. A threshold of 0.72 would also catch the third pair, but sits
0.02 above a pair that must not merge — no margin at all on a model whose
paraphrase similarities cluster tightly. Under-merging is the failure an
operator can see (two rows for one need); over-merging hides a question,
so the safer side is chosen. Eight pairs is thin evidence: re-run the
script once a real project has traffic and move the knob if the band
between same and different needs has moved.
