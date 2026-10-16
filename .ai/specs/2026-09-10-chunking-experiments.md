# Chunking experiments: what the embedding sees

> Status: done · 2026-09-10 — both experiments measured and rejected; defaults unchanged

**Goal.** After the retrieval defaults were chosen on measurement (spec:
retrieval-defaults), the remaining retrieval failures cluster on one shape of
page: short, canonical, one chunk long. Those pages are retrieved about half
the time; multi-chunk pages almost always. Ranking knobs have been exhausted;
what is left is what the embedding is computed from. This spec records
experiments on that input, each measured against the current baseline on the
private tuning set, and keeps only what wins.

## Design

**Experiment 1 — embed the title with the chunk. Measured; reverted.** A
chunk's embedding is computed from its text alone; the document title
reaches the model prompt but never the vector. The hypothesis was that a
short page's single chunk opens mid-topic while its title says what the page
answers. Both embedding paths were made to embed `title + "\n\n" + content`
(stored `content` untouched), the tuning corpus was re-embedded on a clone,
and retrieval got **worse** — see Measurements. The change was removed
rather than kept behind a flag: a knob nobody should turn is not a feature.
The re-embedding path it needed stays, because an operator needs it anyway.

**Re-embedding without the dashboard.** `scripts/reindex-project.ts` runs the
existing resumable re-index loop (`runReindex`) directly against
`DATABASE_URL` for one project and target version — the same code path the
worker runs, minus the queue. An operator changing the embedding input or
model needs this anyway; an experiment needs it now.

**Experiment 2 — chunk size.** Env knobs `DESKBELL_CHUNK_TARGET_CHARS`,
`DESKBELL_CHUNK_MAX_CHARS` and `DESKBELL_CHUNK_OVERLAP_CHARS` (defaults
unchanged: 2800 / 3600 / 350) read by the ingest handler, so a corpus can be
re-crawled at another size into a separate database and measured. Only run
if experiment 1 leaves the one-chunk gap open.

**Measure, then keep or revert.** Each experiment is a retrieval-only run on
a clone of the tuning database (so the baseline corpus is never touched),
compared to the shipped configuration's numbers, then a judged run for the
winner. A change that does not move recall@8 by at least 0.03 without
costing nDCG is reverted, not shipped.

## Non-goals

- Contextual chunking (a model-written summary prepended per chunk) and
  parent-document retrieval. Both need the full document text retained,
  which the schema does not do today, and a decision on ingest cost.
- Changing the query-side embedding. Measured as-is first.

## Open questions

- Whether a title-bearing embedding should also carry the heading trail the
  chunker already prefixes. It does, by construction — the trail is in
  `content`; the title is what was missing.

## Verify

- `embeddingInput` is used by both embedding paths and nowhere else decides
  the embedding text; the stored `content` is unchanged after a re-index.
- The reindex script re-embeds exactly the rows behind the target version
  and stops, and a second run touches nothing.
- The experiment's retrieval numbers are recorded below with the baseline
  they were measured against.

## Measurements

Private tuning set (99 cases, 79 labelled; 940 chunks in one tenant), k=8,
shipped retrieval defaults (scan depth 100, one chunk per document),
retrieval-only. Baseline: **recall@8 0.882 · MRR 0.685 · nDCG@8 0.720**;
one-chunk pages 0.510 (n=17), multi-chunk pages 0.984 (n=62).

**Experiment 1, title embedded with the chunk:** recall@8 **0.850** · MRR
0.681 · nDCG@8 0.710; one-chunk pages **0.451**, multi-chunk 0.960. Worse on
every number, and worst exactly where it was meant to help: a title
prepended to a chunk moves its vector toward the title's words and away
from the passage that answers the question, while the question is embedded
as asked. Re-embedding verified sound before measuring: 940/940 chunks at
the new version, stored content byte-identical, a second run touched
nothing. Reverted.

**Experiment 2, chunk size 1400 / 1800 / 200 (default 2800 / 3600 / 350).**
The corpus was re-crawled twice into fresh databases, once at each size,
because the site had changed since the baseline crawl (five new pages, four
labelled pages under renamed section paths — the label check refused the
first run and named them; the set used for both arms carries the renamed
paths). Control at the default size: **0.882 · 0.684 · 0.719** — the
baseline exactly, so the corpus change moved nothing. At 1400: 1,843
chunks instead of 951, 31 one-chunk pages instead of 80, and recall@8
**0.846** · MRR 0.684 · nDCG 0.709 — four cases lost, none gained;
one-chunk pages 0.461. With one chunk per document in the answer, a
smaller chunk is simply less of the page, and the extra chunks a page gains
buy it nothing the pool did not already give it. Defaults stay.

**Where this leaves the one-chunk gap.** Two input-side changes were
measured and both lost; the ranking side was settled earlier. The remaining
candidates — a model-written context line per chunk, or retrieving the
whole short page once any chunk of it is hit — need the full document text
retained at ingest and a decision on the ingest cost. Not taken here.
