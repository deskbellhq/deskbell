import { chunks, type Database } from "@deskbell/db";
import { and, eq, inArray } from "drizzle-orm";
import { type HydratedChunk, hydrateChunks } from "./hydrate";
import { type CandidateOrder, orderCandidates } from "./ordering";
import {
  type FusedDiagnostics,
  RETRIEVAL_DEFAULTS,
  type ScoredChunk,
  type SearchQuery,
  type VectorStore,
} from "./vector-store";

/**
 * The Weaviate driver (spec: weaviate-vector-store, vector-store-single-home)
 * — opt-in, for operators who already run Weaviate. Never a default and
 * never a compose service (D11, D13).
 *
 * The collection is the one home of every vector this driver indexes: the
 * Postgres row keeps the chunk's text, position, flags and state, and
 * `upsert` marks it as indexed here — after the object is written, never
 * before. `search` asks Weaviate for ranked ids (per query, per leg) and for
 * each candidate's distance to the canonical query, then reads display
 * fields from the rows of record. An object whose row is gone drops out at
 * hydration instead of reaching an answer.
 *
 * The client is an optional peer dependency loaded through a variable
 * specifier (the local reranker's pattern): its absence is a supported state
 * with a defined error, never a build failure.
 */

export interface WeaviateConfig {
  /** `http://host:8080` or `https://…` — the REST endpoint. */
  url: string;
  /** The gRPC endpoint; defaults to the REST host on 50051, secure when the URL is https. */
  grpcUrl?: string;
  apiKey?: string;
  /** Collection name; one Deskbell install per collection. */
  collection: string;
}

export const WEAVIATE_DEFAULT_COLLECTION = "DeskbellChunk";
/** What this driver writes to `chunks.vector_store`: the collection is part of the identity. */
export function weaviateStoreId(collection: string): string {
  return `weaviate:${collection}`;
}
const WEAVIATE_DEFAULT_GRPC_PORT = 50051;
/** RRF constant — the same one the SQL fusion uses (spec: hybrid-retrieval §2). */
const RRF_K = 60;
/** Objects per batch on the write side; the client sends one gRPC batch per call. */
const INSERT_BATCH = 200;
/** Ids per delete filter on the prune path. */
const DELETE_BATCH = 100;

/** The projection of a chunk that lives in Weaviate. Display fields stay in Postgres. */
export interface WeaviateChunkProperties {
  chunkId: string;
  orgId: string;
  projectId: string;
  documentId: string;
  position: number | null;
  content: string;
  embeddingVersion: number;
}

/**
 * The slice of `weaviate-client` the driver uses, stated locally so the
 * package is never resolved at type-check time and a test can hand in a fake.
 */
export interface WeaviateObject {
  uuid: string;
  properties: Partial<WeaviateChunkProperties>;
  /** `distance` is cosine distance (1 − similarity) on this collection. */
  metadata?: { distance?: number };
}
export interface WeaviateQueryResult {
  objects: WeaviateObject[];
}
export interface WeaviateCollectionApi {
  filter: {
    byProperty(name: string): {
      equal(value: string | number): unknown;
      containsAny(values: string[]): unknown;
    };
    byId(): { containsAny(uuids: string[]): unknown };
  };
  data: {
    insertMany(
      objects: Array<{ id: string; properties: WeaviateChunkProperties; vectors: number[] }>,
    ): Promise<{ hasErrors: boolean; errors: Record<number, { message: string }> }>;
    deleteMany(where: unknown): Promise<unknown>;
  };
  query: {
    nearVector(
      vector: number[],
      opts: {
        limit: number;
        filters: unknown;
        distance?: number;
        returnProperties: Array<keyof WeaviateChunkProperties>;
        /** Omitted on a leg that needs ids only: the client rejects an empty list. */
        returnMetadata?: ["distance"];
      },
    ): Promise<WeaviateQueryResult>;
    bm25(
      query: string,
      opts: {
        limit: number;
        filters: unknown;
        queryProperties: Array<keyof WeaviateChunkProperties>;
        returnProperties: Array<keyof WeaviateChunkProperties>;
      },
    ): Promise<WeaviateQueryResult>;
    fetchObjects(opts: {
      limit: number;
      after?: string;
      returnProperties: Array<keyof WeaviateChunkProperties>;
    }): Promise<WeaviateQueryResult>;
  };
}
export interface WeaviateClientApi {
  collections: {
    exists(name: string): Promise<boolean>;
    createFromSchema(schema: Record<string, unknown>): Promise<unknown>;
    get(name: string): WeaviateCollectionApi;
  };
}
/** A connected client plus the filter combinator the module exports. */
export interface WeaviateBinding {
  client: WeaviateClientApi;
  and(...filters: unknown[]): unknown;
}

/**
 * Chunk ids are `chunk_` + the 32 hex digits of a UUID (shared `newId`);
 * Weaviate object ids must be UUIDs. Restoring the dashes is reversible and
 * needs no lookup table, and a retried upsert lands on the same object.
 */
export function chunkIdToUuid(chunkId: string): string {
  const hex = chunkId.startsWith("chunk_") ? chunkId.slice("chunk_".length) : chunkId;
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`chunk id ${chunkId} is not chunk_ + 32 hex digits — cannot map to a UUID`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function uuidToChunkId(uuid: string): string {
  return `chunk_${uuid.replaceAll("-", "").toLowerCase()}`;
}

/**
 * The collection, as a plain schema object (the REST shape) rather than the
 * client's builder API: fewer surfaces to fake, and the shape is what an
 * operator sees in Weaviate's own tooling. Vectorizer `none` — Deskbell
 * computes every vector, so a driver switch never changes what one means.
 */
export function weaviateCollectionSchema(name: string): Record<string, unknown> {
  const key = (n: keyof WeaviateChunkProperties) => ({
    name: n,
    dataType: ["text"],
    tokenization: "field",
    indexFilterable: true,
    indexSearchable: false,
  });
  return {
    class: name,
    description: "Deskbell chunk index — vectors computed by Deskbell, rows of record in Postgres",
    vectorizer: "none",
    vectorIndexType: "hnsw",
    vectorIndexConfig: { distance: "cosine" },
    properties: [
      key("chunkId"),
      key("orgId"),
      key("projectId"),
      key("documentId"),
      { name: "position", dataType: ["int"], indexFilterable: false },
      { name: "embeddingVersion", dataType: ["int"], indexFilterable: false },
      {
        name: "content",
        dataType: ["text"],
        tokenization: "word",
        indexFilterable: false,
        indexSearchable: true,
      },
    ],
  };
}

/** `WEAVIATE_URL` and the derived gRPC endpoint, as the client's connect options. */
export function weaviateConnectOptions(config: WeaviateConfig): {
  httpHost: string;
  httpPort: number;
  httpSecure: boolean;
  httpPath?: string;
  grpcHost: string;
  grpcPort: number;
  grpcSecure: boolean;
} {
  const http = new URL(config.url);
  const httpSecure = http.protocol === "https:";
  const httpPort = http.port ? Number(http.port) : httpSecure ? 443 : 80;
  const grpc = config.grpcUrl ? new URL(config.grpcUrl) : undefined;
  const grpcSecure = grpc ? grpc.protocol === "https:" || grpc.protocol === "grpcs:" : httpSecure;
  const grpcPort = grpc?.port
    ? Number(grpc.port)
    : grpc
      ? grpcSecure
        ? 443
        : 80
      : WEAVIATE_DEFAULT_GRPC_PORT;
  const path = http.pathname.replace(/\/+$/, "");
  return {
    httpHost: http.hostname,
    httpPort,
    httpSecure,
    ...(path ? { httpPath: path } : {}),
    grpcHost: grpc?.hostname ?? http.hostname,
    grpcPort,
    grpcSecure,
  };
}

/**
 * Loads the real client through the optional dependency and connects. The
 * specifier is a variable on purpose: bundlers and the type checker must not
 * try to resolve a package that is legitimately absent.
 */
async function connectWeaviate(config: WeaviateConfig): Promise<WeaviateBinding> {
  const optionalDependency = "weaviate-client";
  let mod: {
    connectToCustom: (opts: Record<string, unknown>) => Promise<WeaviateClientApi>;
    ApiKey: new (key: string) => unknown;
    Filters: { and(...filters: unknown[]): unknown };
  };
  try {
    mod = await import(optionalDependency);
  } catch (cause) {
    throw new Error(
      `DESKBELL_VECTOR_STORE=weaviate needs the optional dependency ${optionalDependency} — ` +
        "install it next to the apps that run the engine and the worker (pnpm add " +
        `${optionalDependency}), or unset DESKBELL_VECTOR_STORE to use pgvector.`,
      { cause },
    );
  }
  const client = await mod.connectToCustom({
    ...weaviateConnectOptions(config),
    ...(config.apiKey ? { authCredentials: new mod.ApiKey(config.apiKey) } : {}),
  });
  return { client, and: (...filters) => mod.Filters.and(...filters) };
}

/**
 * One connection per process per configuration. The web app builds engine
 * deps per request; reconnecting (and re-checking the collection) each time
 * would put a round trip in front of every answer. A failed connection is
 * dropped so the next call retries instead of caching the failure.
 */
const bindings = new Map<string, Promise<WeaviateBinding>>();

async function ensureCollection(binding: WeaviateBinding, name: string): Promise<void> {
  if (await binding.client.collections.exists(name)) return;
  await binding.client.collections.createFromSchema(weaviateCollectionSchema(name));
}

function bind(
  config: WeaviateConfig,
  connect: (config: WeaviateConfig) => Promise<WeaviateBinding>,
): Promise<WeaviateBinding> {
  const key = JSON.stringify([
    config.url,
    config.grpcUrl ?? "",
    config.collection,
    config.apiKey ?? "",
  ]);
  const cached = bindings.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const binding = await connect(config);
    await ensureCollection(binding, config.collection);
    return binding;
  })();
  bindings.set(key, pending);
  pending.catch(() => {
    if (bindings.get(key) === pending) bindings.delete(key);
  });
  return pending;
}

/** Test seam: forget cached connections so each test binds afresh. */
export function resetWeaviateBindings(): void {
  bindings.clear();
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

interface PoolEntry {
  score: number;
  rank: number;
  variant: number;
  legs: Set<"vector" | "lexical">;
}

/** Fold one ranked leg into the pool with the spec's tie rule (earlier variant wins). */
function foldLeg(
  pool: Map<string, PoolEntry>,
  ids: string[],
  variant: number,
  leg: "vector" | "lexical",
): void {
  ids.forEach((id, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);
    const existing = pool.get(id);
    if (!existing) {
      pool.set(id, { score: rrf, rank, variant, legs: new Set([leg]) });
      return;
    }
    existing.legs.add(leg);
    existing.score = Math.max(existing.score, rrf);
    if (rank < existing.rank) {
      existing.rank = rank;
      existing.variant = variant;
    }
  });
}

/** Chunk rows as Weaviate objects, in batches. */
async function writeObjects(
  col: WeaviateCollectionApi,
  orgId: string,
  items: Parameters<VectorStore["upsert"]>[1],
): Promise<void> {
  for (let i = 0; i < items.length; i += INSERT_BATCH) {
    const slice = items.slice(i, i + INSERT_BATCH);
    const result = await col.data.insertMany(
      slice.map((c) => ({
        id: chunkIdToUuid(c.chunkId),
        properties: {
          chunkId: c.chunkId,
          orgId,
          projectId: c.projectId,
          documentId: c.documentId,
          position: c.position,
          content: c.content,
          embeddingVersion: c.embeddingVersion,
        },
        vectors: c.embedding,
      })),
    );
    if (result.hasErrors) {
      const first = Object.values(result.errors)[0];
      throw new Error(
        `weaviate: ${Object.keys(result.errors).length} of ${slice.length} objects failed to insert — ${first?.message}`,
      );
    }
  }
}

export interface WeaviateDriverDeps {
  /** Test seam: a fake client instead of the optional dependency. */
  connect?: (config: WeaviateConfig) => Promise<WeaviateBinding>;
  /** Test seam: marking rows without Postgres. */
  markIndexed?: typeof markRowsIndexed;
  /** Test seam: hydration without Postgres. */
  hydrate?: typeof hydrateChunks;
}

/**
 * The state transition, after the store has the vector: the row records
 * which store, the model and the generation — and drops any vector it held,
 * because a vector lives in exactly one place (spec: vector-store-single-home).
 * One statement per (model, generation) pair; a batch almost always has one.
 */
export async function markRowsIndexed(
  db: Database,
  orgId: string,
  storeId: string,
  items: Parameters<VectorStore["upsert"]>[1],
): Promise<void> {
  const groups = new Map<string, { model: string; version: number; ids: string[] }>();
  for (const c of items) {
    const key = `${c.embeddingModel}\u0000${c.embeddingVersion}`;
    const group = groups.get(key) ?? {
      model: c.embeddingModel,
      version: c.embeddingVersion,
      ids: [],
    };
    group.ids.push(c.chunkId);
    groups.set(key, group);
  }
  for (const { model, version, ids } of groups.values()) {
    await db
      .update(chunks)
      .set({
        embedding: null,
        embeddingModel: model,
        embeddingVersion: version,
        vectorStore: storeId,
      })
      .where(and(eq(chunks.orgId, orgId), inArray(chunks.id, ids)));
  }
}

export function createWeaviateVectorStore(
  db: Database,
  config: WeaviateConfig,
  deps: WeaviateDriverDeps = {},
): VectorStore {
  const connect = deps.connect ?? connectWeaviate;
  const markIndexed = deps.markIndexed ?? markRowsIndexed;
  const hydrate = deps.hydrate ?? hydrateChunks;
  const storeId = weaviateStoreId(config.collection);

  // Warm-up: start connecting now so the first request finds the client
  // ready and a misconfiguration shows in the log at boot — but construction
  // never throws and never blocks; the request path reports the real error.
  bind(config, connect).then(
    () => console.log(`[vector-store] weaviate: ${config.url} collection=${config.collection}`),
    (err: unknown) =>
      console.error(
        `[vector-store] weaviate: cannot connect to ${config.url} — ${err instanceof Error ? err.message : String(err)}`,
      ),
  );

  const collection = async () => {
    const binding = await bind(config, connect);
    return { binding, col: binding.client.collections.get(config.collection) };
  };

  const scopeFilter = (
    binding: WeaviateBinding,
    col: WeaviateCollectionApi,
    orgId: string,
    scope: { projectId: string } | { documentId: string },
  ) =>
    binding.and(
      col.filter.byProperty("orgId").equal(orgId),
      "projectId" in scope
        ? col.filter.byProperty("projectId").equal(scope.projectId)
        : col.filter.byProperty("documentId").equal(scope.documentId),
    );

  const idsOf = (result: WeaviateQueryResult): string[] =>
    result.objects.map((o) => o.properties.chunkId ?? uuidToChunkId(o.uuid));
  /** Cosine similarity from the collection's cosine distance; null when Weaviate sent none. */
  const scoreOf = (o: WeaviateObject): number | null =>
    typeof o.metadata?.distance === "number" ? 1 - o.metadata.distance : null;
  const assemble = (
    hydrated: HydratedChunk[],
    scores: Map<string, number | null>,
  ): Map<string, Omit<ScoredChunk, "fused">> =>
    new Map(hydrated.map((r) => [r.chunkId, { ...r, score: scores.get(r.chunkId) ?? null }]));

  return {
    id: storeId,

    async search(orgId, queries, opts) {
      if (queries.length === 0) return [];
      const mode = opts.mode ?? RETRIEVAL_DEFAULTS.mode;
      const minScore = opts.minScore ?? RETRIEVAL_DEFAULTS.minScore;
      const canonical = queries[0] as SearchQuery;
      const { binding, col } = await collection();
      const filters = scopeFilter(binding, col, orgId, { projectId: opts.projectId });

      if (queries.length === 1 && mode === "vector") {
        // The shipped default: one ANN query, Weaviate's order kept, its
        // distance the score. Cosine distance is 1 − similarity, so the floor
        // is a distance ceiling on the query and a check on the answer.
        const result = await col.query.nearVector(canonical.embedding, {
          limit: opts.limit,
          filters,
          ...(minScore > 0 ? { distance: 1 - minScore } : {}),
          returnProperties: ["chunkId"],
          returnMetadata: ["distance"],
        });
        const ids = idsOf(result);
        const scores = new Map(
          result.objects.map((o) => [o.properties.chunkId ?? uuidToChunkId(o.uuid), scoreOf(o)]),
        );
        const byId = assemble(await hydrate(db, orgId, opts.projectId, ids), scores);
        const ordered: ScoredChunk[] = [];
        for (const id of ids) {
          const row = byId.get(id);
          if (!row) continue;
          if (minScore > 0 && row.score !== null && row.score <= minScore) continue;
          ordered.push(row);
        }
        return ordered;
      }

      const legDepth = clampInt(opts.legDepth ?? RETRIEVAL_DEFAULTS.legDepth, opts.limit, 1000);
      const pool = new Map<string, PoolEntry>();
      for (let variant = 0; variant < queries.length; variant++) {
        const q = queries[variant] as SearchQuery;
        const legs: Array<Promise<{ leg: "vector" | "lexical"; ids: string[] }>> = [
          col.query
            .nearVector(q.embedding, { limit: legDepth, filters, returnProperties: ["chunkId"] })
            .then((r) => ({ leg: "vector" as const, ids: idsOf(r) })),
        ];
        // A question with no lexemes has no lexical leg — the leg stays silent
        // rather than asking BM25 to search for nothing (spec: hybrid-retrieval §1).
        if (mode === "hybrid" && q.text.trim() !== "") {
          legs.push(
            col.query
              .bm25(q.text, {
                limit: legDepth,
                filters,
                queryProperties: ["content"],
                returnProperties: ["chunkId"],
              })
              .then((r) => ({ leg: "lexical" as const, ids: idsOf(r) })),
          );
        }
        // Legs of one variant fold in a fixed order so the pool is
        // deterministic whichever call returns first.
        for (const { leg, ids } of await Promise.all(legs)) foldLeg(pool, ids, variant, leg);
      }
      if (pool.size === 0) return [];

      // The single scoring pass (spec: hybrid-retrieval §3), performed by the
      // index that has the vectors: one query for the canonical question,
      // restricted to the pooled ids, returns each candidate's distance. A
      // filter this small is searched flat, so the distances are exact, and
      // no vector crosses the wire.
      const pooledIds = [...pool.keys()];
      const scored = await col.query.nearVector(canonical.embedding, {
        limit: pooledIds.length,
        filters: binding.and(filters, col.filter.byId().containsAny(pooledIds.map(chunkIdToUuid))),
        returnProperties: ["chunkId"],
        returnMetadata: ["distance"],
      });
      const scores = new Map(
        scored.objects.map((o) => [o.properties.chunkId ?? uuidToChunkId(o.uuid), scoreOf(o)]),
      );
      const byId = assemble(await hydrate(db, orgId, opts.projectId, pooledIds), scores);
      const pooled = [...byId.values()].map((r): ScoredChunk => {
        const f = pool.get(r.chunkId) as PoolEntry;
        const fused: FusedDiagnostics = {
          score: f.score,
          rank: f.rank,
          variant: f.variant,
          legs: [...f.legs],
        };
        return { ...r, fused };
      });
      // The floor applies to candidates that HAVE a score; null is "not
      // scored", never "unrelated" (spec: hybrid-retrieval §5).
      const floored =
        minScore > 0 ? pooled.filter((c) => c.score === null || c.score > minScore) : pooled;
      return orderCandidates(floored, "fused" satisfies CandidateOrder).slice(0, opts.limit);
    },

    async upsert(orgId, items) {
      if (items.length === 0) return;
      // The store first, the row second: a row never claims a vector the
      // store does not have. If the mark fails the row stays pending, the
      // job retries, and the retry overwrites the same object.
      const { col } = await collection();
      await writeObjects(col, orgId, items);
      await markIndexed(db, orgId, storeId, items);
    },

    async deleteByDocument(orgId, documentId) {
      const { binding, col } = await collection();
      await col.data.deleteMany(scopeFilter(binding, col, orgId, { documentId }));
    },
  };
}

/**
 * Every object the collection holds — `chunkId` and `orgId` only, in pages —
 * for the prune script. Cursor pagination (`after`) is the one
 * form Weaviate does not cap at the query limit, and it cannot be combined
 * with a filter, so the walk is over the whole collection and the caller
 * groups by org. An operator's walk over their own index, not a request
 * path; every delete it leads to is org-scoped.
 */
export async function* listWeaviateChunks(
  config: WeaviateConfig,
  deps: { connect?: (config: WeaviateConfig) => Promise<WeaviateBinding>; pageSize?: number } = {},
): AsyncGenerator<Array<{ uuid: string; chunkId: string; orgId: string }>> {
  const binding = await bind(config, deps.connect ?? connectWeaviate);
  const col = binding.client.collections.get(config.collection);
  const pageSize = deps.pageSize ?? 500;
  let after: string | undefined;
  for (;;) {
    const page = await col.query.fetchObjects({
      limit: pageSize,
      ...(after ? { after } : {}),
      returnProperties: ["chunkId", "orgId"],
    });
    if (page.objects.length === 0) return;
    yield page.objects.map((o) => ({
      uuid: o.uuid,
      chunkId: o.properties.chunkId ?? uuidToChunkId(o.uuid),
      orgId: o.properties.orgId ?? "",
    }));
    if (page.objects.length < pageSize) return;
    after = page.objects[page.objects.length - 1]?.uuid;
  }
}

/** Delete objects by id — the prune script. */
export async function deleteFromWeaviate(
  config: WeaviateConfig,
  orgId: string,
  chunkIds: string[],
  deps: { connect?: (config: WeaviateConfig) => Promise<WeaviateBinding> } = {},
): Promise<void> {
  if (chunkIds.length === 0) return;
  const binding = await bind(config, deps.connect ?? connectWeaviate);
  const col = binding.client.collections.get(config.collection);
  // Scoped by org even though ids are unique: no delete path is unscoped (D12).
  for (let i = 0; i < chunkIds.length; i += DELETE_BATCH) {
    await col.data.deleteMany(
      binding.and(
        col.filter.byProperty("orgId").equal(orgId),
        col.filter.byProperty("chunkId").containsAny(chunkIds.slice(i, i + DELETE_BATCH)),
      ),
    );
  }
}
