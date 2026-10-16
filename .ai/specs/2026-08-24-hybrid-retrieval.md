# Hybrid retrieval: a lexical leg, fusion, and a rerank seam

> Status: **mechanics built 2026-08-26; first defaults chosen by measurement 2026-09-10**
> (spec: retrieval-defaults — the per-document cap and the ANN scan depth flipped on
> numbers; the lexical leg, multi-query and both rerankers measured and stayed off) —
> §0 settled by measurement
> 2026-08-25; the schema (step 2), the single-table fix (step 3), hybrid + multi-query
> retrieval (step 4), the rerank seam with an LLM driver (step 7) and the sweep tooling
> are implemented behind `DESKBELL_RETRIEVAL_*` / `DESKBELL_RERANK*` with every shipped
> default preserving prior ranking byte-for-byte. The retrieval-floor item shipped early
> via `2026-08-24-grounded-generation.md` §5. Still open: step 6 (overlap stripping) and
> §7 (the cache).
>
> Resolved the `TODO(spec: hybrid-retrieval)` markers that pointed here.
> **Default flips stay gated on the eval harness (D8).** The mechanics exist so they can
> be measured; nothing ranking-affecting turns ON without a before/after number on a
> golden set — that gate is the point of the spec, not a formality. `pnpm sweep` runs the
> named configurations side by side.

**Goal.** Retrieval is vector-only, with a fixed top-k and no lexical leg. Semantic search
fails hardest on exactly what documentation questions are made of: error codes, field and
API names, version numbers, product identifiers — tokens whose value is that they match
*literally*. Adding a lexical leg and fusing the two is the largest single quality lever
available. It is also the change least possible to evaluate by inspection, which is why it
is sequenced behind the harness rather than in front of it.

## Design

### Why this waits for the harness

The failure mode of a retrieval-augmented answer engine is not the obviously wrong answer.
It is the fluent, confident, *almost* right one — the kind a human spot-check waves
through. A retrieval change moves that distribution in a direction no sample of a dozen
questions will reveal, and a change that improves five questions while quietly breaking
three looks like success in a demo.

So every item below carries a number or does not ship. This is D8 applied to the work D8
exists for.

### 0. Verify this first: how the tenant filter reaches the index

A design review raised a claim that has to be **confirmed with `EXPLAIN (ANALYZE)` against a
real corpus before anything is built on it**, because it changes the shape of §1.

The observation: the tenant predicate sits on `sources.project_id`, two joins away from
`chunks`, so it cannot be pushed into an index scan on `chunks`. If the planner is using
the HNSW index, the approximate scan finds its nearest neighbours *before* the tenant
predicate is applied and the join then discards the ones belonging to other tenants —
which would mean a multi-tenant deployment silently returns short result sets, or none, for
questions its own documents answer. That would be a D12 defect in effect: the query is
org-*correct* but not org-*scoped at the index*.

There is a competing possibility that must be checked at the same time, because it changes
the conclusion entirely: the query orders by `desc(1 - cosineDistance(...))`, an expression,
rather than by the `<=>` operator the pgvector index is defined on. If the planner does not
match that to the index, retrieval is doing an exact sequential scan today — correct
results, no tenant leak, and a scaling problem instead.

**Measured 2026-08-25** — pgvector 0.8.6, `EXPLAIN (ANALYZE, BUFFERS)` against the dev
corpus (97 chunks) plus a synthetic second tenant holding 200 identical copies of every
vector (19,497 rows total). Identical copies are the deliberate worst case: it is what
shared boilerplate across tenants looks like to the index. Four findings, one design
consequence.

1. **Today's defect is the sequential read — and fixing the ORDER BY alone changes
   nothing.** The HNSW index is unused in every shape, including `ORDER BY embedding <=>
   q`. With the tenant predicate two joins away, the planner drives from
   `documents`→`sources` and computes the distance for every row the tenant owns, then
   top-N sorts; it also misestimates the join output (118 estimated vs 19,400 actual),
   because a predicate on another table gives it nothing to estimate chunk cardinality
   with. Measured on the 19.4k-chunk tenant: 2.0 s (production shape) and 4.6 s (operator
   shape) — both exact scans; 2.5 ms at 97 chunks. Correct results, linear scaling.

2. **The tenant-leak reading is real, latent, and worse than guessed.** Forcing the HNSW
   path with the tenant filter — the plan a naive ORDER-BY fix would eventually produce —
   the 97-chunk tenant received **2 of the 8 requested rows** (380 nearer neighbours
   discarded as other-tenant). Raising `ef_search` to 400, enabling
   `hnsw.iterative_scan = relaxed_order`, and raising `max_scan_tuples` to 100k **all
   still returned 2**: under duplication the starvation is structural, not a tuning
   shortfall — the graph's neighbour lists saturate with the other tenant's identical
   points and the scan cannot escape the cluster. Post-filtering a shared ANN index is
   not a tenant boundary.

3. **The §1 fix is confirmed, with numbers.** The single-table shape that denormalising
   `project_id` produces lets the planner choose per tenant: btree + exact top-N for the
   small tenant (1.1 ms — the cheap and correct answer at that size), HNSW for the
   dominant one (25.5 ms strict, **0.34 ms** with `iterative_scan = relaxed_order`). Set
   `relaxed_order` in the same `SET LOCAL` transaction §2 already requires.

4. **New deferred-list consequence: mid-size tenants are the risk window.** Small tenants
   get exact scans by cost; dominant tenants own the neighbourhood; a mid-size tenant on
   the HNSW path can still be starved by neighbours it cannot use. The observable symptom
   is retrieval returning fewer rows than the limit while the tenant holds more than the
   limit — log that shortfall, and give the harness a crowded-tenant fixture when leg
   depth is swept.

Denormalising `project_id` onto `chunks` stands as the fix, now on measurement rather
than argument.

### 1. The lexical leg

Postgres full-text search over `chunks.content`, indexed with GIN.

**Column shape: a stored generated `tsvector` column, not an expression index.** An
expression index requires the query-side expression to match character for character or the
planner silently falls back to a sequential scan — a failure that surfaces months later as
"retrieval got slow" with nothing in the code pointing at it. A materialised column is
greppable and `EXPLAIN`-verifiable. Costs accepted: a table rewrite in the migration, and
roughly 30–50% of `content`'s size on disk. Drizzle-kit cannot express the generated
expression, so the migration is hand-corrected before it is applied — the precedent for
hand-augmented generated SQL already exists in the migrations directory.

**Text-search configuration: one fixed config, `simple` + `unaccent`.** The mechanism,
because the obvious wiring does not work: `unaccent()` the *function* is only STABLE, so
it cannot appear in a generated-column expression at all. Instead the migration creates a
`deskbell_search` text search configuration (`COPY = simple`) with unaccent chained as a
**filter dictionary** on the word mappings — the config name is then a constant
`regconfig`, which is exactly what keeps `to_tsvector()` IMMUTABLE where the column
needs it. The query side extracts lexemes with the same config constant. Not
per-language, for two independent reasons either of which settles it:

1. **It is not expressible.** `to_tsvector(regconfig, text)` is `IMMUTABLE` only because the
   config is constant; a column-valued config is not, and Postgres will refuse the generated
   column. Worse, at query time the *question's* language is unknown, so there would be no
   principled way to choose the config to parse it with.
2. **The coverage is not there.** Postgres ships snowball stemmers for roughly 25 languages
   and none for Polish, Czech, Slovak, Ukrainian, Bulgarian, Croatian or Slovenian. A
   per-language design would give German stemming and Polish nothing — the worst outcome for
   a product whose golden set deliberately includes a Polish corpus with German questions.

**No stemming is the right answer here rather than a compromise.** The two legs have
different jobs. The vector leg already covers morphology, synonymy and paraphrase — that is
what an embedding is. What embeddings are systematically bad at is exact tokens: config
keys, error codes, API names, version strings, identifiers. Those are what an unstemmed
lexical index is for. Adding stemming would make this leg a worse copy of the other one.
`unaccent` is included because it is language-neutral and fixes a real European failure — a
visitor typing `zurich` or `sesja` without diacritics. It is a *trusted* extension since
PG13, so it installs without superuser on managed Postgres, and a contrib extension is not
a service — rule 7 is untouched.

**Query side, where full-text search for question answering usually goes wrong.**
`plainto_tsquery` and `websearch_to_tsquery` AND their terms. Under a config that keeps
stopwords, "How do I rotate my API key?" becomes a conjunction including `how`, `do`, `i`,
`my` — and matches nothing, ever. Shipping that would ship a leg that never fires. Build
the query instead as an **OR of the question's own lexemes**, extracted with the same
config so no user punctuation can reach the tsquery parser, and rank with
**`ts_rank_cd`** (cover density), which scores by how tightly the matched terms cluster. A
chunk containing only "my" scores near zero. Cover density plus a leg-depth cap is what
makes an OR query behave.

**Tenant scoping: denormalise `project_id` onto `chunks`,** with a btree on
`(org_id, project_id)` — the leading column also satisfies the rule 3 index requirement.
Add `position` (0-based index within the document) in the same migration: it is what §6
needs, and it is not backfillable later, since chunk ids are random and a document's rows
share a timestamp. Pre-existing rows get `null` and are fixed by re-syncing the source.

### 2. Fusion

Reciprocal rank fusion over the lexical and semantic legs.

**Fusion belongs across modalities, not across paraphrases** — this distinction is worth
stating because the same word covers both and only one of them works:

- Between a *lexical* and a *semantic* leg, RRF's signal — "this document surfaced in
  several independent result lists" — is real, because the two legs rank on genuinely
  different evidence. This is the case here, and it is the case every existing reference in
  this repository intends.
- Between several *paraphrases of one query against one index*, that signal is close to
  absent: the result lists overlap barely, so "appeared in several lists" has nothing to
  say. Multi-query expansion needs one comparable scoring pass over the pooled candidates,
  not fusion. See §3.

**Fuse in SQL** — two CTEs, one `FULL OUTER JOIN`, one final `LIMIT` — not in TypeScript
over two queries. The TypeScript form is easier to unit-test and was the tempting option;
four things decided against it, in descending weight:

1. **Torn reads.** Two statements see two snapshots, and a re-sync deletes and re-inserts a
   document's chunks. Between the legs, a chunk id can vanish, so you would fuse a rank list
   against a set that no longer contains it. One statement is one snapshot.
2. **The parallelism argument evaporates.** The vector leg needs a `SET LOCAL` for the ANN
   search depth, which requires a transaction — so both legs would run on the same
   connection inside it, serialised anyway.
3. **One place to audit the tenant scope.** Rule 3 is review-enforced; one query shows the
   predicate in both legs and the join.
4. **One `LIMIT` over the fused list**, which TypeScript fusion can only approximate by
   over-fetching.

Cost accepted: the fusion arithmetic is not unit-testable without Postgres. That matches the
repo's existing posture — `apps/web/vitest.config.ts` already records that SQL is verified
against a real Postgres in a documented manual pass — and the harness is the real regression
net for retrieval anyway.

**`k = 60`**, the standard value, with a consequence worth stating rather than inheriting
silently: at `k = 60` with legs 50 deep, a chunk appearing in *both* lists always outranks a
chunk appearing in only one, including that list's top hit. That is the right trade here —
"the lexical index and the embedding space independently nominated this passage" is the
strongest evidence available without a reranker. The flip side is that for a purely
conceptual question with no lexical anchor, weakly-relevant text that appears in both legs
can be promoted over the true vector top hit. **Leg depth is the knob that governs this**,
and its right value depends on corpus size and query mix — first item on the deferred list.

Two mechanical notes that will otherwise cost an afternoon: the RRF constant is an operand
of arithmetic, so it cannot be a bind parameter; and `SET LOCAL` cannot take one either.
Also, pgvector's default ANN search depth is 40, so a leg depth of 50 is silently truncated
unless it is raised.

**How multi-variant execution landed (built):** N reuses of the per-query fusion
statement inside ONE `REPEATABLE READ` read-only transaction, pooling in the driver, then
one hydration-and-scoring statement over the pooled union in the same transaction. "One
statement is one snapshot" generalises to "one transaction is one snapshot" through the
isolation level, which closes the torn-read hazard without generating an N-ary SQL
monster in which the tenant predicate would appear in 2N+1 places. The single-query
vector search is the same code path's degenerate case and runs the plain statement —
byte-identical to prior behaviour, which is what keeps the fixture gate green. One guard
learned the hard way from §0's own tooling: `SET LOCAL` on a GUC the server does not have
**aborts the whole transaction**, so `hnsw.iterative_scan` is applied only after a
one-time `pg_settings` probe (cached on the driver) finds it — older pgvector servers
simply run without relaxed iterative scan. The query-side tsquery is built inside the
statement: lexemes extracted with the config constant, each **quoted** so nothing a
visitor types can reach the tsquery parser as an operator; zero lexemes yields a NULL
tsquery, which matches nothing and keeps the leg silently empty rather than erroring.

### 3. Multi-query retrieval

`2026-08-24-grounded-generation.md` produces a query plan and searches only the canonical
question. This issues the rest of it: run the variants, pool the candidates, deduplicate,
then score the **union once** against the canonical question.

The single scoring pass is the load-bearing part. Scoring each variant's results separately
costs roughly N times the latency for the same final ordering, because scoring serializes
in a way that candidate generation does not. Candidates are cheap; scoring them is not.

Sizing goes behind `DESKBELL_RETRIEVAL_*` variables, named and documented so operators read
them as **a latency budget, not a quality dial** — the failure mode otherwise is a
self-hoster turning the numbers up until answers get slow, in the belief they are turning
quality up.

**The concrete shape (built):** leg statements are skinny — ids and ranks only — and the
scoring pass is one final statement over the pooled union computing cosine to the
canonical question, in the same snapshot the legs read. The union is **never pruned on
fusion scores** before that pass — they cluster far too tightly to be a safe pre-filter;
leg depth, a rank cut, is the only candidate-stage narrowing. The candidate **pool**
(default 24) exists only where something downstream chooses from it — hybrid legs,
pooled variants, or a reranker; on the default path it collapses to the answer size. A
**per-document cap** (`maxPerDocument`, default off) applies at FINAL selection in
TypeScript, never per leg and never per variant: per-leg it would prune the union before
scoring, per-variant it caps nothing once the variants pool. It exists because top-k
over chunks hands a long document one slot per chunk while a short canonical page gets
exactly one shot.

### 4. The rerank seam

A `Reranker` interface with a **no-op default**, so `docker compose up` requires nothing new
(D11).

Being straight about the trade this makes: a cross-encoder reranker is the single largest
remaining quality lever, and it is the one the Postgres-only self-host bar rules out as a
default, because it means shipping a model-serving sidecar. That is a real cost of D11, not
a neutral choice, and the spec should say so rather than implying a no-op default is
equivalent.

Candidate drivers, all optional and off unless configured:

- **LLM-as-reranker** through the existing injected model deps — no new infrastructure, no
  new provider surface, and it inherits model-agnosticism for free (D4, D13). Built.
- **A local in-process cross-encoder** — the purpose-built instrument, run on CPU inside
  the existing process so D11 holds. Built 2026-08-26; the dependency and download
  trade-offs it accepts are its own record, `2026-08-26-local-cross-encoder-reranker.md`.
- **Hosted rerank APIs** as opt-in drivers, for operators who want the quality and accept
  the network dependency. Sketched only: a `reranker(id)` switch in `models/index.ts`
  beside `languageModel`/`embeddingModel`, its SDK import confined to that module.

The engine must behave correctly with no reranker present. Absent, ordering is whatever
fusion produced.

**As built.** `Reranker` is a function `RerankInput → Promise<RerankResult>`:
input is the CANONICAL question plus the pooled candidates in fused order (one scoring
query across the pool is what makes the resulting order comparable at all); output is
`order` — indices best-first, because the array order IS the output (§5) — plus optional
driver-scale scores that nothing thresholds. It injects as the optional
`EngineDeps.rerank`, following the planner's pattern with one deliberate difference:
implementations MAY reject, because the ENGINE owns the fallback — on a throw or
timeout it keeps fusion order, logs loudly, and (when a rerank-stage floor one day
exists) must skip it, since a floor without scores is meaningless. `applyRanking` is a
pure repair function: out-of-range, duplicate and non-integer indices are dropped,
unmentioned candidates append in fused order — a noisy model degrades, never throws.

**The LLM driver** (`DESKBELL_RERANK=llm`, model from `DESKBELL_RERANK_MODEL`, default
the chat model): listwise, one structured-output call — pointwise costs N serialized
calls for poorly calibrated absolute numbers, and a comparative ordering is the judgment
the task needs. The prompt demands a **total order**: measured live on this driver,
inviting the model to omit "clearly unrelated" passages produced an *empty* ranking —
no signal at all — because deciding how many results are worth using is the limit's job,
not the model's. The count is stated in prose AND bounded in the schema (providers do
not enforce array length — the planner's lesson). Candidates cap at 50 and excerpt at
1500 characters: a latency-and-cost budget. Construction is lazy, so a bad model id
degrades quality instead of failing every answer. Timeout default 10 s, measured rather
than guessed: a reasoning model needs ~7 s for a full listwise ranking of six passages,
and a tighter budget degrades every request while still paying for the tokens. A fast
non-reasoning rerank model is the operator advice.

**Final ordering with no reranker** is its own decision, expressed as a pure function
with a knob (`order`, default `fused`): best fused rank first, ties toward the canonical
variant, then cosine, then id. Re-sorting the pool by cosine-to-canonical is the obvious
alternative and the default would be wrong to take: the lexical leg exists precisely to
surface exact-token matches sitting at middling cosine, and a cosine re-sort re-buries
exactly those hits — the leg would measurably stop doing the one thing §1 built it for.
`cosine` ships as the sweep alternative so the harness can arbitrate.

### 5. Score semantics

**`score` stays cosine similarity; the fusion score becomes a separate field that nothing
may threshold; the array order is the ranking.**

Making `score` the raw RRF value was the obvious move and is wrong: RRF magnitude depends on
the constant and on how many legs fired, so a "within X of the best" rule over it silently
means two different things depending on whether the top hit was cross-modal. Normalising it
to [0,1] fixes the range and not the problem. Cosine is cheap to keep — the query embedding
is already in hand, and it is one expression over the handful of rows that survive fusion —
and it is the only scale a consumer can reason about.

A chunk that matched lexically but has no embedding yet gets `score: null`. That is honest
and forces the consumer to decide, where `0` would masquerade as "unrelated". It makes
`score` nullable, which is a breaking type change with a blast radius of zero today —
nothing reads it — and doing it now, before citation selection is written against it, is
the point.

What citation selection **may** infer: a ratio-to-best rule over `score`, array position,
and cross-modal agreement as a confidence hint. What it **may not**: that `score` is
monotonic down the array (it is not — a chunk can rank high on an exact lexical match at
middling cosine), that the fusion score can be thresholded, or that `null` means low
relevance.

The distance rule this enables:

- A citation cut-off should be a **distance, not a count**. A fixed cap cannot distinguish
  "six genuinely relevant documents" from "one relevant and three irrelevant"; that
  difference appears as distance from the top score.
- A relative rule needs one **absolute backstop** for the case it cannot see. When the
  corpus does not cover a question at all, every result scores badly *and uniformly* — so
  everything sits within the relative window, and the honest output is to cite nothing
  beneath an answer that already says it does not know.

Both thresholds have to be calibrated against real traffic on a real corpus, and pinned by
tests carrying the actual scores they were derived from, so they cannot be tidied later
into round numbers nobody measured.

**Shipped row shape:** `score` is nullable cosine-to-canonical exactly as above; `fused`
is an optional diagnostics object (best RRF value, best rank, which variant achieved it,
the union of nominating legs) that nothing may threshold; `position` (0-based index
within the document) rides along, null on rows ingested before the column existed. One
adjacent defect fixed while making `score` nullable: under the old
`ORDER BY (1 - distance) DESC`, a chunk still awaiting its embedding had a NULL distance
that sorted FIRST — a mid-ingest corpus led with unembeddable rows. The vector leg now
reads only embedded rows, and NULL score means "no embedding yet", which is never
floorable and sorts last under cosine order.

### 6. Near-duplicate collapse

The chunker prefixes each chunk with a 350-character tail of the previous one, so adjacent
chunks share text by construction. Retrieval can return several near-copies of one passage
and spend the top-k on them.

Deduplicate on **source identity, not storage identity** — the row id is the wrong key
precisely because near-duplicates have different ones. Whether this runs as a SQL window
function or a TypeScript post-filter depends on where fusion lands (§2).

**Where deduplication landed (built):** cross-variant pooling dedupes by chunk id, which
is sound *within one snapshot* — ids cannot be re-minted mid-transaction, and that is the
point of §2's transaction; `(documentId, position)` is the durable identity for logs and
tests across re-syncs. The per-document cap (§3) is the shipped instrument against
near-copies spending the top-k. **Overlap stripping — the shared-prefix removal this
section is really about — remains step 6, deliberately unstarted**, so its effect can be
attributed separately.

### 7. Answer and embedding cache

Normalised-question keying, in Postgres. It is tenant data, so the table carries `org_id`
and an index on it (D12).

Interaction worth designing now rather than discovering: **a re-index must invalidate the
cache.** Re-embedding the corpus changes what retrieval would return, and a cache serving
pre-reindex answers is serving answers the current corpus would not produce. The
invalidation hook belongs in the reindex job (`2026-08-24-ingestion-pipeline.md`).

### 8. Cross-language retrieval

Verified as an eval case — a corpus in one language, questions in another — rather than as
a code change hoping to be right. The system prompt already promises to answer in the
user's language; nothing verifies that retrieval crosses languages at all, and the choice
of text-search configuration in §1 directly affects whether it can.

`AskInput.locale` is accepted by the request schema and passed by the route, and then used
by nothing. Whether it should reach retrieval or the prompt is an open question shared with
the grounded-generation spec.

### 9. What here is decision material, and what only looks like it

Moving refusal off the similarity floor and onto the model's `NO_GROUNDING` contract
(grounded-generation §5, finished here by choosing the default) changes who owns the
product's honest-refusal behaviour and what the harness's numbers measure. That earns a file
in `.ai/decisions/`.

Note that the numbering is not a running count of the files present — it is deliberately
non-contiguous, and `.ai/README.md` is explicit that a gap is not a missing document. Take
the next genuinely unused number rather than the one after the highest file on disk, or the
new file will collide with an existing decision.

Not needing a file: the reranker never becoming a compose service — D11 already decides
that, and minting a number for a decision already made is what `.ai/README.md` warns
against. Cite D11 in the interface's doc comment and add a rule line to
`packages/core/AGENTS.md` instead. The `unaccent` extension and the `project_id`
denormalisation likewise need no new decision: one is not a service, and the other
strengthens D12 rather than bending it.

### 10. Drive-by fixes this work should make

Three decision citations in the code point at the wrong decision, which rule 9 makes bugs:
`retrieval/vector-store.ts` attributes the interface-based retrieval rule to D12 when it is
D13's content, and two comments in `engine.ts` cite D12 for injection defence and for the
answer cache. Verify each against the decision files and correct them while in this code.

## Non-goals

Any vector store other than pgvector as a self-host requirement (D13: the interface is the
guarantee, the driver is not). A reranker sidecar in `docker-compose.yml`. Contextual
chunking. Connectors. Changing the chunker's overlap strategy — §6 addresses the symptom
deliberately, because changing chunking invalidates the whole corpus and deserves its own
measurement.

## Open questions

First, the one that is not a knob: **§0 has to be settled with a query plan before §1 is
built.** It is the only open item that could change the design rather than tune it.

The rest are "measure, don't guess" — properties of the corpus and the query mix, not of
the design. Each should be a sweep in the harness, not a number someone picked while
writing the code. **The sweep tooling exists** (`scripts/sweep-evals.ts`, `pnpm sweep`):
its default matrix runs baseline / hybrid / multi-query / both / per-document cap /
cosine order / LLM rerank side by side, and a `--configs` file expresses anything below.

- **Leg depth** (default 50) — the most consequential constant, for the reason given in §2.
- Weighted versus unweighted fusion; shipping unweighted.
- OR-of-lexemes versus an AND query; shipping OR, because AND returns nothing under a
  stopword-keeping config. The precision/recall trade is measurable.
- Whether the query lexemes need an IDF or stopword filter. Cover-density ranking plus the
  depth cap is the argument for "no"; this is the first thing to try if the leg
  disappoints.
- `maxPerDocument`, 2 versus 3.
- The answer chunk count, currently 8 — fusion should raise precision at the top, so 8 may
  now be more context than is useful, and context length is both a cost and a quality
  variable.
- Retrieval floor default. The grounded-generation spec moves it to configuration and
  defaults it off; whether any non-zero default beats zero is answerable only here, and the
  answer is a property of the embedding model, so it must be re-measured per model.
- Citation distance and absolute-floor thresholds.
- Whether an LLM reranker earns its latency and tokens, or whether the honest answer is
  that reranking stays a hosted opt-in.
- A trigram leg for typo tolerance; a composite GIN to fold the tenant filter into one index
  scan; neighbour expansion via `position ± 1`, newly possible once `position` exists.
- ANN search depth: recall against CPU, measurable directly against a brute-force ground
  truth.

## Implementation order

Each step leaves the tree green, and steps 4 and 5 are deliberately separate so their
effects can be attributed.

1. ✅ Done 2026-08-25 — §0 settled with `EXPLAIN (ANALYZE)`; the answer is recorded in §0.
   (It is both readings: an exact scan today, and a structural starvation if the index is
   ever reached through a post-filter.)
2. ✅ Done 2026-08-26 — migration 0007: `project_id` (backfilled then tightened),
   `position`, `search_tsv`, the extension and the `deskbell_search` config; all three
   ingest writers stamp the new columns; verified on a migrated copy of the dev corpus
   (97/97 backfilled, 97/97 generated tsvectors).
3. ✅ Done 2026-08-26 — interface (`vector-store.ts`) and driver (`pgvector.ts`) split;
   predicates on `chunks` alone; `ORDER BY` on the bare `<=>` operator so the planner can
   choose the index per tenant. Verified: identical rows in identical order vs the old
   query (8/8), single-table plan driving `chunks_org_project_idx`, 0.9 ms.
4. ✅ Mechanics done 2026-08-26, **default-off**: lexical leg, SQL fusion, multi-query
   pooling, per-document cap, new score shape, `search()` replacing `query()` on every
   caller so the product and the harness measure one path. **The harness run that flips
   any default is the remaining half** — gated on the golden set, swept via `pnpm sweep`.
5. ✅ Shipped early (2026-08-25) via `2026-08-24-grounded-generation.md` §5: floor off by
   default, `DESKBELL_RETRIEVAL_MIN_SCORE`, operator docs. The harness attribution note
   still applies in reverse: when step 4's defaults flip, the report is against the
   floor-off baseline, and any future non-zero default is a harness sweep per the open
   questions.
6. Overlap stripping and shared context assembly. **Open.**
7. ✅ Done 2026-08-26 — the reranker seam (`EngineDeps.rerank`, no-op default) and the
   listwise LLM driver, live-verified on a real model. `docker-compose.yml` diff empty —
   the acceptance criterion for rule 7 held.
8. ✅ Done 2026-08-26 — stale decision citations corrected (interface header D12→D13;
   the prompt's injection-defence cite D12→D7; the cache TODO now points at this spec
   with D12 scoped to tenancy); both `TODO(spec: hybrid-retrieval)` markers removed.

## Verify

The harness is the verification. For each item: a before/after report on the golden set,
committed alongside the change. Specifically:

- Answered rate, correct-refusal rate, and groundedness before and after the lexical leg.
- A targeted subset of exact-token questions — error codes, field names, version strings —
  where the lexical leg should show its largest gain. If it does not, the leg is not doing
  what this spec claims it does.
- Cross-language cases, per §8.
- Latency at p50 and p95 for each retrieval configuration, since §3's sizing is explicitly
  a latency budget.
- Citation thresholds pinned by tests carrying real scores.

Anything that cannot show a number does not ship in this spec.
