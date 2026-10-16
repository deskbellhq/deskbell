# Corrections: answers written by hand, indexed like everything else

> Status: in progress · 2026-09-17

**Goal.** The gaps page says what visitors could not get answered and, on
request, what to write. It offers no way to write it. The only source is the
website crawler, so closing a gap means editing the docs site, waiting for
the next crawl, and hoping the new page ranks. This adds a second source that
holds answers an operator types into the dashboard. Each answer is a document
under that source, chunked and embedded through the same pipeline as a
crawled page, retrieved by the same query, and cited by the same rule. An
answer can be written from a gap cluster, in which case saving it resolves
the cluster, or on its own from a management page. Retrieval does not know
the difference between a correction and a page.

## Design

**One source per project, made on first use.** A `sources` row with type
`corrections` and an empty config. The dashboard creates it the first time an
answer is saved, with an insert that does nothing on conflict followed by a
read, and a partial unique index on `sources(project_id) where type =
'corrections'` guarantees one row per project even when two editors save at
once. It never appears in the connector registry: connectors discover
documents from external configuration and have no database access, and a
corrections source has nothing external to discover from.

**An answer is a document.** `title` is the question, on one line. `content`
is the question as a level-one heading followed by a blank line and the
answer. `url` is null: the citation schema only accepts a real URL, and a
placeholder would fail validation and drop every citation on the message with
it. The chunker keeps a heading inside the chunk that starts with it and
prefixes the heading trail to the chunks that follow, so the question is in
the embedded text of every chunk and a visitor's phrasing lands near it by
similarity. No new columns on `documents`: the answer for the edit form is the
content with the exact heading prefix removed, and since the question is
validated single-line and only the dashboard writes this shape, the round
trip is deterministic.

**A cluster points at its answer.** `gap_clusters.correction_document_id`,
nullable, references `documents` and is set null when the document goes.
Saving from a cluster sets the pointer and resolves the cluster with the same
columns the resolve action writes. Editing from a cluster resolves it again:
an edit after a reopen is the operator saying the fix is in now. Deleting the
answer does not reopen the cluster; the status is a statement about the
questions and stays until a new occurrence contradicts it, which the
assignment job already does when a gap message arrives after `resolved_at`.

**Indexing is one job per document.** `ingest.document` takes an org, a
source and a document id. The handler reads the document, replaces its
chunks, and enqueues `embed.chunks`, which already flips the source to
`ready` once nothing in it is left unembedded. The chunk, flag, insert and
enqueue steps move out of the source ingest handler into one function both
handlers call, with its dependencies injected so it is testable without a
database. The source ingest handler runs the connector branch only for
sources with a connector; for a corrections source, "sync" enqueues
`ingest.document` for each of its documents. Saving sets the source to
`pending`, so the sources page shows the same lifecycle for every row.

**Operator text is still data.** The injection heuristics run on correction
chunks exactly as on crawled ones. An editor's account can be shared or
compromised, and the rule that content is never instructions has no
exception for content that arrived through a form.

**Two entry points, one form.** The cluster's detail panel gains an Answer
section: the answer as text with an edit button when one exists, otherwise a
button that swaps in the form with the question filled from the cluster's
label and the analysis, when there is one, shown beside the textarea as the
thing to write from. The row's menu offers the same. A page under Sources
lists every answer in the project with its linked cluster, and adds, edits and
deletes them; the sources page shows the corrections row with its count and
a link to that page instead of a URL. Writing, editing and deleting are
editor actions, the same bar as resolving a cluster or syncing a source.

**The onboarding guide ignores corrections.** Its first step is a crawl of
the operator's docs, and a hand-written answer neither shows a URL nor stands
in for them.

## Non-goals

- Ranking corrections above crawled pages. They compete; the question in the
  chunk text is what makes them competitive. A preference would need source
  provenance on retrieved chunks and an ordering rule, and there is no
  measurement yet that says the competition is lost.
- A synthetic URL so a correction can be labelled in an eval dataset by URL.
  Datasets can name the document id; a stable label form for corrections is
  its own decision.
- Rendering answers as markdown. They are shown as text, like the analysis.
- More than one answer per cluster, or splitting an answer across clusters.

## Open questions

- Whether an answer should carry the cluster's other phrasings in its text as
  well as the label. Cheap to add; not added until a miss shows the label
  alone was not enough.
- Whether a corrections source should ever satisfy the onboarding guide, for
  an operator with no docs site at all.

## Verify

- Save an answer from an open cluster: a document exists with a null URL and
  content starting with the question as a heading, the cluster is resolved
  and points at it, the worker logs `ingest.document` then `embed.chunks`,
  the first chunk contains the question, and the source goes `pending` to
  `ready`.
- Ask the question through the widget: the answer is grounded in the
  correction and the citation is a pill labelled as a written answer (spec:
  answer-citation-labels).
- Edit the answer: the hash changes, the old chunks are gone, the new ones
  are embedded. Delete it: document and chunks are gone, the cluster keeps
  its status and its pointer is null.
- A later gap message on the cluster reopens it and the row offers to edit
  the answer.
- Sync on the corrections row re-indexes every answer and ends `ready`.
- The overview guide still waits for a docs site when the only source is
  corrections.
- Tests: the indexing function writes positions, carries the project, flags
  and enqueues; the form helpers round-trip and reject a multi-line question;
  the browser suite writes an answer from a cluster, sees it resolved and
  listed, and adds, edits and deletes from the management page.
