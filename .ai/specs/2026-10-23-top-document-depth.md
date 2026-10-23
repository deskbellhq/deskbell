# Top-document depth

**Status:** shipped 2026-10-23, default `topDocumentChunks: 3`. Measurements
below decided the default (D8).

## Problem

Final selection keeps one chunk per document (spec: retrieval-defaults). That
hands eight distinct pages to the model, which is right when the answer sits
on one short page. It is wrong when the answer *is* a long page: a page that
lists sixteen categories in four chunks reaches the model as one chunk, and
the model names the four or seven categories it saw. No prompt can fix an
answer the context does not contain. Raising the cap for every document was
measured (cap 2: recall@8 0.882 → 0.819) and rejected: it spends slots on
second chunks of pages that were never the answer.

## Design

`deepenTopDocument(pool, selected, max)` runs after the cap and the slice to
`limit`. It takes the document of the top-ranked chunk, pulls that document's
other chunks from the ordered pool, in pool order, up to `max` chunks of the
document in total, and appends them after the selection. The extras come
after `limit`: no other page loses its slot and the first `limit` hits are
exactly what they were, so recall@k and MRR cannot move (a first version put
the extras right after the top chunk, and recall@8 read 0.883 → 0.858 purely
because hits 7 and 8 fell past the cut while the model still received them).
The cost is tokens, and only on turns where the top page has more chunks in
the pool. The pool is already requested whenever the cap is on, so nothing
new is fetched.

Knob: `DESKBELL_RETRIEVAL_TOP_DOC_CHUNKS` (integer ≥ 1, default 1 = off),
`--top-doc-chunks` on `pnpm evals`.

## What it does not do

It does not fetch neighbours by position. A chunk of the top page that the
pool does not hold is not relevant enough to the question to arrive; fetching
it anyway would reintroduce the long-page bias the cap removed, one page at a
time. If measurement shows list pages need position-adjacent chunks the pool
misses, that is a second experiment.

## Verify

- Unit: extras follow the selection in pool order, respect the allowance,
  count what the selection already holds, 1 = off, empty stays empty.
- Judged run on the private set with `--top-doc-chunks 3` against a same-day
  control; read Factuality and false-refusal first, recall@8 second (it
  cannot move), p95 latency and tokens last.

## Measurements

Private set, 101 cases (80 answerable, 21 unanswerable), LLM judge, two
judged samples per arm on the same day. Run-to-run noise on this set is about
six case grades per run, so only moves that repeat in both samples count.

| Metric | Control (1) | Top document 3 |
|---|---|---|
| Factuality | 80.8% / 80.0% | 88.8% / 86.7% |
| Uncertainty | 85.7% / 85.7% | 81.0% / 81.0% |
| False-refusal rate | 6.3% / 5.0% | 6.3% / 7.5% |
| Groundedness | 97.3% / 96.1% | 94.7% / 95.9% |
| Unsupported-name rate | 1.3% / 1.3% | 0% / 0% |
| recall@8 | 0.883 | 0.883 |
| Input tokens | 394k / — | 454k (+15%) |
| Output tokens | 37.0k / 34.8k | 36.9k / 36.9k |
| p95 latency | 7.6s / 5.7s | 7.2s / 5.9s |

The same seven answerable cases move from C to A in both samples; one of
them was a refusal of a count question whose answer sits in the second chunk
of the top page. The cost is one more unanswerable case answered per run (a
different case each time) and 15% more input tokens. Groundedness reads 2.6
points lower in the first sample and 0.2 in the second; the control's own
two samples differ by 1.2, so the first reading is within measurement noise.
recall@8 is identical by construction.

Not addressed: a list question whose list page is not the top-ranked
document still grades C in every run. Deepening reaches only the top page;
that case is a retrieval gap, not a prompt or depth problem.
