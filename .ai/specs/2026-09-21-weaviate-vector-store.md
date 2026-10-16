# Weaviate as an optional vector-store driver

> Status: done · 2026-09-21 · Amended the same day by `2026-09-21-vector-store-single-home`:
> the "Postgres remains the system of record, vector included" decision below is
> superseded — the row records which store holds its vector and holds none of its own on
> this driver. The driver, the interface, the selection and the dependency shape stand.

**Goal.** A second `VectorStore` driver for operators who already run Weaviate and
want retrieval to use it. pgvector stays the default and the only driver the
self-host install needs (D11, D13); nothing about `docker compose up` changes.
Selecting the driver is one environment variable; Deskbell keeps owning crawling,
chunking and embeddings — Weaviate holds a search index over vectors Deskbell
computed, and nothing else.

## Design

### The decisions this records

**Postgres remains the system of record for chunks, vector included.** The driver's
`upsert` writes the row exactly as the pgvector driver does, then mirrors a
projection of it to Weaviate. The alternative — skipping the `embedding` column when
Weaviate holds the vector — looks like a saving and is not: the ingest state machine
is a set of Postgres predicates (`embedding IS NULL` means "waiting to be embedded";
`embedding_version` is the re-index generation; spec: ingestion-pipeline), and every
worker path would need a second notion of "embedded" that lives in another system.
Keeping the column also makes the driver switch a config change in both directions:
an operator who turns Weaviate off is back on pgvector without re-embedding. The cost
is the vector stored twice, which at the corpus sizes this product indexes is
megabytes.

**Weaviate nominates; Postgres hydrates and scores.** A search asks Weaviate for
ranked chunk ids — per query, per leg — and hands the pooled ids to the same
hydrate-and-score statement the pgvector driver runs: display fields from
`documents`/`sources`, cosine similarity to the canonical query computed from the
row's own vector. Three things fall out of that:

- The score contract (spec: hybrid-retrieval §5) is identical across drivers, so
  every consumer — floor, ordering, rerank, evals — sees the same scale.
- Titles and URLs are never stale in a second store, because they are not in it.
- A Weaviate object whose row is gone drops out at hydration. A delete that failed,
  or has not happened yet, can therefore never surface a dead chunk; it only wastes
  space until the sync script prunes it.

**No compose service.** The driver connects to a Weaviate the operator runs. Root
rule 7 and D11 are why `docker-compose.yml` is untouched; the docs page shows a
one-line `docker run` for trying the driver locally, which is a thing an operator
does deliberately, not a thing the install does to them.

**Optional for the engine, shipped by the product.** `weaviate-client` is a peer
dependency marked optional in `@deskbell/core`, loaded through a
variable-specifier dynamic import so bundlers and the type checker never resolve
it — core never *requires* it. The workspace root declares it as a runtime
dependency, which puts it on every package's resolution path and into both Docker
images (the Dockerfile asserts this at build time). Unlike the reranker's
`@huggingface/transformers`, which carries native binaries and stays a deliberate
install, the client is ~20 MB of plain JavaScript: cheaper to ship to everyone than
to explain. Selecting the driver with the package somehow absent is still one
error naming the install command. (Amended 2026-09-21: the first cut called it
"installed deliberately next to the apps"; the root dependency was already how the
images got it, so the declaration now says so.) Unlike the reranker there is no fallback — retrieval without a
store is no answers — so the error surfaces on the request path and in the worker
log at boot; it never silently becomes pgvector. An operator who asked for Weaviate
and got pgvector would not find out until the day the two disagreed.

### The driver

- **Selection.** `DESKBELL_VECTOR_STORE=pgvector` (default) `| weaviate`. One factory,
  `createVectorStore(db, env)`, replaces the direct `createPgVectorStore(db)` calls in
  the web app, the worker, the eval target and the re-index script, so every process
  that retrieves or ingests resolves the driver the same way. An unknown value throws
  at construction: a typo here must not quietly run pgvector.
- **Connection.** `WEAVIATE_URL` (`http://host:8080` or `https://…`); the gRPC endpoint
  the client also needs defaults to the same host on port 50051, secure when the URL
  is `https`, and `WEAVIATE_GRPC_URL` overrides it. `WEAVIATE_API_KEY` is optional.
  `WEAVIATE_COLLECTION` names the collection (default `DeskbellChunk`). One client per
  process, keyed by these values; the web app builds engine deps per request and
  must not reconnect per request.
- **Collection.** Created on first use if absent, from a plain schema object rather
  than the client's builder API (fewer surfaces to fake in tests): vectorizer `none`,
  cosine distance, properties `chunkId` · `orgId` · `projectId` · `documentId` (text,
  `field` tokenization, filterable, not searchable), `position` and
  `embeddingVersion` (int), `content` (text, `word` tokenization, searchable — the
  BM25 leg). Vector length is fixed by the first object, as it is by the
  `EMBEDDING_DIMENSIONS` column in Postgres.
- **Object identity.** A chunk id is `chunk_` followed by the 32 hex digits of a UUID;
  the Weaviate object id is that UUID with its dashes restored. Reversible, no lookup
  table, and a retry of the same upsert overwrites the same object. `chunkId` is stored
  as a property as well, for hydration and for pruning.
- **Tenancy (D12).** Every query and every delete carries `orgId` AND `projectId` (or
  `documentId`) filters. Weaviate's native multi-tenancy is not used in this cut: it
  would give each org its own shard, which is stronger isolation than a filter, at
  the cost of tenant lifecycle management on every write path. Property filters are
  what D12 does everywhere else.
- **Search.**
  - Single query, vector mode (the shipped default): `nearVector` with `limit`,
    scoped; a similarity floor becomes `distance ≤ 1 − minScore` (cosine distance is
    `1 − similarity`); results hydrated in Weaviate's order, and the floor applied
    again on the hydrated cosine, which is the one the contract promises.
  - Multi-query and/or hybrid: per query, a vector leg (`nearVector`, `legDepth`) and
    in hybrid mode a lexical leg (`bm25` over `content`, `legDepth`), fused by
    reciprocal rank with the same constant the SQL uses (spec: hybrid-retrieval §2)
    and pooled with the same tie rule (earlier variant wins). The two legs are run
    separately rather than through Weaviate's own `hybrid` query so that the
    diagnostics say which leg nominated a chunk and the fusion is the one the spec
    describes, driver-independent. Then hydrate, floor, `orderCandidates("fused")`,
    slice.
  - `efSearch` is ignored: Weaviate's `ef` is an index-level setting on the
    collection (dynamic by default), not a per-query knob. Documented on the config
    page.
- **Snapshot.** The pgvector driver runs its legs in one REPEATABLE READ transaction.
  Weaviate has no cross-call snapshot: a re-sync between legs can lose a chunk from
  the pool. Hydration bounds the damage to "fewer results", never a wrong one.
- **Deletes.** `VectorStore` gains `deleteByDocument(orgId, documentId)`. For pgvector
  it is a no-op, because the index *is* the `chunks` table and the ingest transaction
  has already replaced the rows; for Weaviate it is `deleteMany` under an
  `orgId AND documentId` filter. Called after `replaceChunks` in the worker and when a
  written answer is deleted in the dashboard — the two paths that remove chunk rows.
- **Warm-up.** Construction starts the connection in the background and logs the
  outcome; it never throws and never blocks (the availability contract the reranker
  follows). A failed connection is dropped from the cache so the next call retries
  rather than caching the failure for the life of the process.

### The sync script

`pnpm vector-store:sync [--org <id>]` pushes every embedded chunk from Postgres into
Weaviate in batches and then prunes objects whose `chunkId` no longer has a row —
for an existing deployment switching the driver on, and for a store that fell behind
(a delete that failed, a Weaviate restore from backup). Idempotent: a second run
finds nothing to do. Postgres is read; nothing there changes.

## Non-goals

- Weaviate as a default, or as a compose service. Both are decisions (D11, D13), not
  configuration.
- Weaviate's vectorizer, generative and reranker modules. Embeddings come from the
  configured embedding model so that a driver switch never changes what a vector
  means; reranking has its own seam (spec: local-cross-encoder-reranker).
- Native multi-tenancy, replication and sharding configuration — the operator's
  cluster settings, applied to the collection they create or by editing it after
  first use.
- Pruning documents the crawler no longer discovers. That is an ingestion gap that
  exists for pgvector too; when it is fixed it goes through `deleteByDocument`.

## Open questions

- Whether the lexical leg should use Weaviate's `hybrid` query (one round trip, server
  fusion) once the eval harness can measure it against the two-leg form. Today the
  two-leg form is chosen for identical semantics across drivers; the round trip is
  the price.
- Whether to add `ready()` to the interface for fail-fast boots. Today the worker logs
  the warm-up outcome, which is visible; a hard fail at boot is a policy the operator
  may not want (a Weaviate restart should not take the worker down with it).

## Verify

- Unit (`packages/core`, 24 tests): id mapping both ways; the schema the driver
  creates; vector mode maps `limit`, filters and the floor; the pooled path fuses two
  legs with the spec's constant and tie rule and reports legs; hydration drops ids
  without rows; `deleteByDocument` sends the scoped filter; a failed connection is
  not cached; the factory rejects unknown values and needs a URL.
- Live, 2026-09-21, Weaviate 1.32.0 in a local container, `weaviate-client` 3.14.0:
  - Sync script on a 940-chunk tuning corpus: 940 pushed, a second run pushes the
    same 940 and prunes 0; a planted orphan object is reported by `--dry-run` and
    removed by the real run. Found on the way: Weaviate's cursor pagination cannot
    take a filter, so the prune walks the whole collection and groups by org.
  - The retrieval-only eval set (99 cases, 79 labelled) on the same corpus with
    each driver, vector mode: recall@8 **0.882 / 0.882**, precision@8 0.121 / 0.121,
    MRR 0.685 / 0.685, nDCG@8 0.720 / 0.720 (pgvector / Weaviate) — identical, as
    the design predicts. Median latency 234 ms / 192 ms.
  - Hybrid mode on both: pgvector 0.719 recall@8 / 0.377 MRR, Weaviate 0.789 / 0.652.
    Different lexical legs (Postgres full text vs BM25), both behind vector-only on
    this corpus; recorded as an observation, not a default.
  - Worker end to end on a copy of the dev database with `WEAVIATE_COLLECTION` set:
    collection created on first use; a written answer re-indexed → 1 row, 1 object
    with the same id; re-indexed again → the old object gone, the new one present;
    a crawler sync of 50 pages (18 changed) → chunks embedded and mirrored; the sync
    script then brought the 32 unchanged pages across (105 = 105).
  - The web app on that database: `/api/v1/ask` refuses a question the corpus does
    not cover, and answers one it does with the correct citation, retrieval through
    Weaviate, one connection per process.
