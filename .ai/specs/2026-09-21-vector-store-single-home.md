# One home for every vector

> Status: done · 2026-09-21
> Amends: 2026-09-21-weaviate-vector-store (the "Postgres remains the system of record,
> vector included" decision). Everything else in that spec stands.

**Goal.** A vector lives in exactly one place: the store the operator configured.
With pgvector that is the `chunks.embedding` column, as today. With Weaviate it is
the collection — and nothing else; the Postgres row keeps the text, the position,
the flags and the *state* of the chunk, never its vector. The operator picks the
store when they set up the install; changing it later means re-indexing, through
the re-index job that already exists, and the install tells them when that is
needed instead of quietly answering from an empty index.

## Design

### What changes from the mirror shape

The first cut of the Weaviate driver mirrored: it wrote the vector to Postgres as
pgvector does, then copied a projection to Weaviate. That bought a free switch back
and left the ingest state machine untouched, at the cost of storing every vector
twice and of Postgres being the store of record for data it no longer searched.
This spec takes the other side of that trade: the row's *state* is explicit instead
of being inferred from the presence of a vector, so the vector can go wherever the
driver puts it.

### The row records where its vector is

`chunks.vector_store text NULL` — the identity of the store that holds this chunk's
vector: `pgvector`, or `weaviate:<collection>`. Null means the chunk has not been
indexed yet. It replaces `embedding IS NULL` as the pending predicate, everywhere:

- `embed.chunks` selects `vector_store IS NULL` for a document and flips the source
  to ready when none remain, exactly as it did with the embedding predicate.
- The Sources page counts indexed chunks by `vector_store IS NOT NULL`, and the
  written-answers list reads its "indexing state" the same way.
- `reindex.embeddings` keeps its predicate — `embedding_version < target` — because a
  re-index is what moves a chunk between stores (below).

Migration `0016`: add the column; backfill `'pgvector'` where `embedding IS NOT NULL`.
Every install that exists is pgvector, so the backfill is exact. The `embedding`
column stays: it *is* the pgvector index.

### Each driver owns the state transition

`upsert` writes the vector to the driver's store and then marks the row — in that
order, so the row never claims a vector the store does not have:

- **pgvector**: the row gets `embedding`, `embedding_model`, `embedding_version`,
  `vector_store = 'pgvector'`, in one statement as today.
- **Weaviate**: `insertMany` to the collection; then the row gets `embedding = NULL`,
  `embedding_model`, `embedding_version`, `vector_store = 'weaviate:<collection>'`.
  Setting `embedding` to null is what enforces "one home": a chunk that was indexed
  in pgvector and is re-indexed into Weaviate drops its Postgres vector at that
  moment. If the row update fails after the object was written, the row still says
  pending, the job retries, and the retry overwrites the same object (same UUID).

`deleteByDocument` is unchanged.

### Scoring comes from the store that has the vector

The score contract (spec: hybrid-retrieval §5) — cosine similarity to the canonical
query for every returned chunk — does not change; where the number comes from does.

- **pgvector**: unchanged. Legs, hydration and cosine in SQL.
- **Weaviate, single query, vector mode**: `nearVector` with `returnMetadata:
  ["distance"]`; cosine distance is `1 − similarity`, so `score = 1 − distance`.
  Hydrate display fields (title, url, source type, content) from Postgres by chunk
  id; keep Weaviate's order; the floor becomes `distance ≤ 1 − minScore` on the
  query and is checked again on the returned distance.
- **Weaviate, pooled path** (multi-query and/or hybrid): the legs run as now and
  return ids only. Then **one scoring call**: `nearVector(canonical)` filtered to the
  pooled ids (`byId().containsAny(uuids)`, limit = pool size) returns each pooled
  candidate's distance to the canonical query — the single scoring pass of
  hybrid-retrieval §3, performed by the index that has the vectors, with no vectors
  on the wire. A filter that small makes Weaviate search the candidates flat, so the
  distances are exact. Hydration from Postgres as above. A chunk can no longer have
  a null score on this driver: objects exist only once embedded, so the lexical leg
  cannot nominate an unembedded chunk.

`hydrate.ts` splits into `hydrateChunks` (display fields, any driver) and the
pgvector-only hydrate-and-score.

### Switching stores is a re-index, and the install says so

Choosing a store is a deployment decision, made in the environment before the first
source is added. To move an existing install:

1. Set `DESKBELL_VECTOR_STORE` (and the store's variables) on the web app and the
   worker; restart both.
2. Press **Re-embed** on the Sources page (or run `scripts/reindex-project.ts`).
   The re-index job reads every chunk's text from Postgres, embeds it, and `upsert`s
   through the *configured* driver — which writes the new store and marks the row.
   Resumable, as it is today: a chunk whose version reached the target is done.
3. Optionally drop the old index: the abandoned Weaviate collection, or nothing for
   pgvector (the rows' `embedding` was nulled by step 2).

Until step 2 finishes, retrieval searches the new store, which fills as the job
runs. That window is the honest cost of the design; what must never happen is the
operator not knowing they are in it. So:

- The Sources page shows, next to the existing "embedded with a model that is not
  the configured one" notice: *N chunks are indexed in `<store>`; the configured
  store is `<store>` — Re-embed to move them.* Same query shape, one more column.
- The worker logs the same count at boot.

Re-embedding costs tokens: the corpus size times the embedding model's price, which
for the sizes this product indexes is cents to a few dollars. Copying vectors
between stores without re-embedding is possible in principle (both stores can return
them) and is deliberately not built: it is a second migration path to test for a
saving that does not justify it. If a corpus ever makes it matter, it lands as an
optimisation of the same job, not a new command.

### Consistency tooling

`pnpm vector-store:sync` goes away — there is nothing to push when Postgres has no
vectors. `pnpm vector-store:prune` keeps the walk-and-compare half: objects in the
collection whose chunk row is gone are deleted, org by org, and the script prints
per-org counts of rows marked as indexed in the store against objects found. A
mismatch in the other direction (rows marked, objects missing — a restore from an
older Weaviate backup) is reported and fixed by Re-embed, which the report says.

### Dimensions

`chunks.embedding` is `vector(1536)` and a re-index into a model with other
dimensions needs a migration — unchanged for pgvector. A Weaviate collection fixes its
dimensions on the first object; a different model means a new collection name
(`WEAVIATE_COLLECTION`), which the `vector_store` value then reflects, and the
notice above tells the operator to re-embed. Documented on the vector-store page.

### What stays in Postgres regardless of driver

The pgvector extension is still required: gap clusters keep their leader embeddings
in Postgres (`gap_clusters.leader_embedding`) and are clustered there. The driver
choice covers the *chunk index* — what retrieval searches — not every vector the
product computes. The docs say so, so nobody uninstalls the extension.

## Non-goals

- Per-organisation or per-project store choice. The store is an install-level
  setting; a hosted multi-tenant deployment that wants tenants on different stores
  is a different product surface.
- Automatic migration on a driver change. Re-index is explicit because it costs
  tokens and time, and because an operator who set the wrong value by accident
  should see a notice, not a bill.
- Copying vectors between stores without re-embedding (see above).

## Open questions

- Whether the Sources-page notice should also block **Re-embed** from being pressed
  twice while a re-index is running. Today the job is resumable and a second press is
  harmless but wasteful; a "running" state on the page would need a job status the
  page does not read yet.

## Verify

- Unit (`packages/core`, 22 driver tests + factory): the driver names itself after the
  collection; single-query scores come from distance and the floor is a distance
  ceiling plus a check; the pooled path issues exactly one filtered scoring call over
  the pooled ids; hydration drops ids without rows and is skipped when nothing is
  nominated; `upsert` writes the object before the row and never marks rows after a
  failed batch; `markRowsIndexed` issues one statement per (model, generation) with
  the vector cleared. Worker and web suites cover the moved predicates.
- Live, 2026-09-21, Weaviate 1.32.0, `weaviate-client` 3.14.0:
  - Migration on a 940-chunk tuning corpus: every row backfilled to `pgvector`; the
    retrieval-only eval set on pgvector unchanged — recall@8 0.882, MRR 0.685,
    nDCG@8 0.720.
  - A copy pointed at an **empty** collection: recall@8 0.000 — nothing is answered
    from a store that has nothing. `scripts/reindex-project.ts` through the driver:
    940 chunks in 28 s; afterwards every row marked `weaviate:<collection>` with
    `embedding` null, 940 objects. The same eval set on the driver: **0.882 / 0.685 /
    0.720**, median 170 ms (pgvector 203 ms); hybrid 0.789 / 0.652 / 0.669, the same as
    when the scores were computed in Postgres.
  - Prune: clean run reports 940 rows marked, 940 objects, 0 pruned; a planted orphan
    is reported by `--dry-run` and removed; a deleted object is reported as a row
    with no object and pointed at Re-embed.
  - A copy of the dev database (98 chunks in pgvector) with the driver configured:
    the worker logs the 98-chunk warning at boot; the Sources page shows *Vector store
    changed* with the counts; the re-index job moves all 98 (0 vectors left in
    Postgres, 98 objects) and the notice clears; a written answer re-indexed and a
    50-page crawl (18 changed) leave 105 rows and 105 objects; `/api/v1/ask` answers
    with the right citation.
  - Found on the way: the client rejects an empty `returnMetadata` list, so the leg
    calls omit it and only the scoring call asks for distance.
