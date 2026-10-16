# Retrieval defaults chosen on measurement

> Status: done · 2026-09-10

**Goal.** Every ranking-affecting retrieval mechanism shipped default-off with
the promise that a default flips only against eval numbers (spec:
hybrid-retrieval). This is the record of those numbers and of what flipped.
It also closes a defect the first measurement exposed: the single-query vector
path — the shipped default — runs the HNSW index at pgvector's own scan depth
with no way to change it, and at that depth a tenant-filtered scan misses
pages an exact scan finds.

## Design

**Scan depth is a retrieval setting.** `efSearch` joins `RetrievalOptions`,
`SearchOptions` and `RETRIEVAL_DEFAULTS` (env `DESKBELL_RETRIEVAL_EF_SEARCH`,
sweep flag `--ef-search`, recorded in eval provenance). The pgvector driver
applies it as `SET LOCAL hnsw.ef_search` inside a read-only transaction on
**both** paths: the single-query path now opens one for exactly this purpose,
and the pooled path takes `max(legDepth, efSearch)` where it previously took
`max(legDepth, 40)`. Where the server offers `hnsw.iterative_scan`, the
single-query path enables `relaxed_order` as the pooled path already did —
without it a scan that exhausts its candidates under the tenant filter
returns short.

The default is 40, pgvector's own, so the change is byte-identical until a
number says otherwise; the first sweep below chooses the shipped value.

**Why this was invisible.** Before chunks carried `project_id`, the vector
query joined through `documents` and `sources` and the planner never used
the index: every search was an exact scan. The single-table query the
denormalisation made possible reaches the index, and the index is
approximate. On the private tuning set (99 cases, 940 chunks in one tenant)
the same code scores recall@8 0.766 with the index dropped and 0.703 with it
present; the false-refusal rate doubled with it. An index that costs six
points of recall at a thousand chunks is not a launch-grade default.

**Sweep, then flip.** Each mechanism is measured on the private tuning set
with `pnpm sweep` (retrieval-only, so the numbers are exact and cheap) against
the step-0 baseline recorded in `baselines/private/`. A default flips when
recall@8 improves by at least 0.03, or nDCG@8 does with recall not falling,
p95 latency stays under twice the baseline, and nothing new is required at
install. Multi-query arms run with `DESKBELL_QUERY_PLANNING=always` — under
the default `followups` the planner short-circuits on a first turn and the
arm measures nothing. Numbers and decisions are appended below as they land.

## Non-goals

- A reranker on by default. Both drivers cost something at install or per
  answer that the sweep alone cannot justify; that is a separate decision.
- Tuning the HNSW build parameters (`m`, `ef_construction`). Build-time
  knobs need a re-index to measure; the scan depth is a query-time knob.

## Open questions

- Whether `iterative_scan` should be a setting rather than probed and
  always-on. Left as probed: it only changes what happens when a scan comes
  back short, which is never the wanted outcome.

## Verify

- `efSearch` reaches the store on the default path and on the pooled path;
  `--ef-search` reaches the engine on a `--project` run and appears in
  `retrievalConfig`.
- The fixture gate does not move (the memory store ignores the setting).
- A `--project` run with `--ef-search 400` on the private set matches the
  exact-scan numbers recorded in step 0 within one case.
- Every flip commit carries its before/after numbers.

## Measurements

Private tuning set, 99 cases (79 labelled), 940 chunks in one tenant, k=8,
retrieval-only unless stated. Baseline = the shipped defaults before this
spec (`efSearch` 40, no cap, vector, single query): **recall@8 0.730 ·
MRR 0.609 · nDCG@8 0.625**; judged: Factuality 81.9%, false-refusal 12.7%.

**Scan depth.** 40 → 100: recall@8 0.730 → **0.793**, MRR 0.609 → 0.673,
nDCG 0.625 → 0.689; 200, 400 and 1000 are identical to 100; p95 latency
unchanged (~260 ms). Split by the `single-chunk-doc` tag: single-chunk pages
0.127 → 0.304, multi-chunk 0.895 → 0.927. **Flipped to 100.**

**Per-document cap** (at depth 100): cap 1 recall@8 **0.882** / MRR 0.685 /
nDCG 0.720 (single-chunk pages 0.510, multi-chunk 0.984); cap 2 0.819;
cap 3 0.819. Precision@8 falls by construction (more distinct documents in
eight slots). Judged, cap 1: Factuality 81.2%, false-refusal **6.3%**,
groundedness 95.9% — quality unchanged within single-run noise, refusals
halved. Judged, cap 2: Factuality 85.9%, false-refusal 8.9%. **Flipped to
1**; cap 2 alone did not clear the recall threshold.

**Lexical leg.** Hybrid with fused order loses at every leg depth: 8 → 0.743,
16 → 0.743, 50 → 0.669, 100 → 0.534 (RRF lets lexical noise outrank the
vector leg). With cosine order it equals plain vector (0.793; with cap 1,
0.876 vs 0.882) at higher latency. **Stays off.**

**Multi-query** (planner forced on, so the arm measures something): 0.776;
with cap 1, 0.833 — below plain cap 1 at ~10 s p50 for the planner call.
**Stays off.**

**Rerankers** (pool 24, cap 1): LLM driver 0.882 / MRR 0.692 — +0.007 MRR
for ~10 s per answer; local cross-encoder 0.831 — worse. **Both stay off.**

**Combinations** (cap 1 throughout): hybrid-cosine + local reranker 0.825;
hybrid-cosine + multi-query 0.825; hybrid-fused (leg 16) + multi-query
0.726. Nothing stacked beats the two flips alone, and every combination
costs seconds. A second judged run of the shipped configuration read
Factuality 81.4% / false-refusal 7.6% against 81.2% / 6.3% — the quality
numbers are stable to within a point; retrieval numbers are exact.

Reports: the private set's sweep reports under `packages/evals/reports/sweep/`
(labels `s1-*`, `s2-*`, `s2b-*`) and its judged cap-1 / cap-2 reports beside
them (all gitignored, as every private-set artifact is).
