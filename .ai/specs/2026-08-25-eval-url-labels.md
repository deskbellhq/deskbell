# Label eval retrieval by URL, resolve to document ids at run time

> Status: implemented · 2026-08-25

## Problem

`EvalCase.relevantDocumentIds` holds `documents.id` primary keys. Those are
minted by `newId("doc")` in the ingest handler, which means they are stable
across a **re-sync** of an existing URL (document identity is
`(orgId, sourceId, url)`) but **not** across:

- deleting and re-adding a source,
- rebuilding the database,
- pointing the same question set at a second deployment of the same corpus.

Any of those re-mints every id. A question set is meant to live for months and
be re-run after each retrieval change, so at least one of them will happen.

The failure mode is what makes this worth fixing rather than documenting. A
stale id does not error — `scoreRetrieval` simply never matches it, so recall@k
and MRR for that case drop to zero and the run reads as a **retrieval
regression**. That is precisely the confusion the harness exists to prevent: an
eval that reports a regression which did not happen is worse than no eval,
because it costs a debugging session before anyone suspects the labels.

It is also partially silent. Re-crawling changes ids only for documents that
were actually removed and re-added, so a typical breakage moves a handful of
cases and leaves the rest correct — which looks like a real, localised
regression rather than a data problem.

## Decision

Cases may carry **`relevantUrls`** instead of (or alongside) `relevantDocumentIds`.
When a run targets a real project, URLs are resolved to document ids against
that project's corpus immediately after the dataset loads, before anything is
asked.

`relevantDocumentIds` stays. The committed fixture uses it with in-memory slugs
and must keep working with no database.

**An unresolvable URL is a hard error that names every miss.** This is the
load-bearing detail. Filling in an empty label instead would reintroduce exactly
the silent-zero-recall failure this change exists to remove, one level up. If a
labelled URL is not in the corpus, either the corpus is incomplete or the label
is wrong, and both are things to fix before trusting any number from the run.

Both sides are normalised before matching — lowercased host, fragment removed,
trailing slash removed. `documents.url` stores the crawler's *final* URL after
redirects, which will not always be what someone copied from a browser.

## What this rules out

- Hand-authoring `doc_…` ids. They are an implementation detail of one
  ingestion run.
- A separate remap script. It has the same defect one level up: it needs a human
  to remember to run it at the exact moment they are thinking about something
  else.
- Resolving on the fixture path. The fixture must stay offline and deterministic,
  so resolution lives in the lazily-imported project target and never loads
  when `--project` is absent.

## Where it bites in code

- `packages/evals/src/types.ts` — `relevantUrls?: string[]` on `EvalCase`.
- `packages/evals/src/dataset.ts` — schema field; no new refinement, since a
  case with neither label is legal (it just scores no retrieval metrics).
- `packages/evals/src/target/project.ts` — `normalizeDocUrl` and the resolver,
  returned from `createProjectTarget` bound to the pool it already opened.
- `scripts/run-evals.ts` — resolves between loading the dataset and running.

## Verify

- A case labelled by URL scores identical retrieval metrics to the same case
  labelled by id.
- A URL that is not in the corpus fails the run and names the URL.
- Trailing slash, uppercase host and `#fragment` all resolve.
- The fixture path opens no database and its numbers do not move.
