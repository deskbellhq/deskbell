import type { Database } from "@deskbell/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { hydrateChunks } from "./hydrate";
import type { ScoredChunk, VectorStore } from "./vector-store";
import {
  chunkIdToUuid,
  createWeaviateVectorStore,
  deleteFromWeaviate,
  listWeaviateChunks,
  markRowsIndexed,
  resetWeaviateBindings,
  uuidToChunkId,
  type WeaviateBinding,
  type WeaviateChunkProperties,
  type WeaviateCollectionApi,
  type WeaviateConfig,
  weaviateCollectionSchema,
  weaviateConnectOptions,
  weaviateStoreId,
} from "./weaviate";

const CONFIG: WeaviateConfig = { url: "http://weaviate.test:8080", collection: "DeskbellChunk" };
const ORG = "org_1";
const PROJECT = "proj_1";
const DB = {} as Database;

/** Filters are opaque to the driver; the fake records what it was asked for. */
type Filter = {
  and?: Filter[];
  property?: string;
  equal?: unknown;
  containsAny?: unknown;
  ids?: string[];
};

interface FakeCalls {
  nearVector: Array<{ vector: number[]; opts: Record<string, unknown> }>;
  bm25: Array<{ query: string; opts: Record<string, unknown> }>;
  fetchObjects: Array<Record<string, unknown>>;
  inserted: Array<{ id: string; properties: WeaviateChunkProperties; vectors: number[] }>;
  deleted: Filter[];
  created: Array<Record<string, unknown>>;
}

function fakeBinding(
  responses: {
    /** Ranked ids for a vector leg, or for the scoring call when the filter carries ids. */
    nearVector?: (vector: number[]) => string[];
    /** Cosine distance per id the scoring call and single-query searches return. */
    distances?: Record<string, number>;
    bm25?: (query: string) => string[];
    fetchPages?: string[][];
    exists?: boolean;
    insertErrors?: Record<number, { message: string }>;
  } = {},
): { binding: WeaviateBinding; calls: FakeCalls } {
  const calls: FakeCalls = {
    nearVector: [],
    bm25: [],
    fetchObjects: [],
    inserted: [],
    deleted: [],
    created: [],
  };
  const objects = (ids: string[]) =>
    ids.map((id) => ({
      uuid: chunkIdToUuid(id),
      properties: { chunkId: id, orgId: ORG },
      ...(responses.distances && id in responses.distances
        ? { metadata: { distance: responses.distances[id] as number } }
        : {}),
    }));
  /** The scoring call is a nearVector restricted to ids; the fake answers with those ids. */
  const idsIn = (filter: Filter | undefined): string[] | undefined => {
    if (!filter) return undefined;
    if (filter.ids) return filter.ids.map(uuidToChunkId);
    for (const f of filter.and ?? []) {
      const found = idsIn(f);
      if (found) return found;
    }
    return undefined;
  };
  const pages = [...(responses.fetchPages ?? [])];
  const col: WeaviateCollectionApi = {
    filter: {
      byProperty: (property) => ({
        equal: (value) => ({ property, equal: value }) satisfies Filter,
        containsAny: (values) => ({ property, containsAny: values }) satisfies Filter,
      }),
      byId: () => ({ containsAny: (ids) => ({ ids }) satisfies Filter }),
    },
    data: {
      async insertMany(batch) {
        calls.inserted.push(...batch);
        const errors = responses.insertErrors ?? {};
        return { hasErrors: Object.keys(errors).length > 0, errors };
      },
      async deleteMany(where) {
        calls.deleted.push(where as Filter);
        return {};
      },
    },
    query: {
      async nearVector(vector, opts) {
        calls.nearVector.push({ vector, opts });
        const restricted = idsIn(opts.filters as Filter);
        return { objects: objects(restricted ?? responses.nearVector?.(vector) ?? []) };
      },
      async bm25(query, opts) {
        calls.bm25.push({ query, opts });
        return { objects: objects(responses.bm25?.(query) ?? []) };
      },
      async fetchObjects(opts) {
        calls.fetchObjects.push(opts);
        return { objects: objects(pages.shift() ?? []) };
      },
    },
  };
  const binding: WeaviateBinding = {
    client: {
      collections: {
        exists: async () => responses.exists ?? true,
        createFromSchema: async (schema) => {
          calls.created.push(schema);
        },
        get: () => col,
      },
    },
    and: (...filters) => ({ and: filters as Filter[] }) satisfies Filter,
  };
  return { binding, calls };
}

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `chunk_${(i + 1).toString(16).padStart(32, "0")}`);

/** Hydration that knows the ids in `known`; ids off the list are "gone". */
function fakeHydrate(known: string[]): typeof hydrateChunks {
  return async (_db, _org, _project, chunkIds) =>
    chunkIds
      .filter((id) => known.includes(id))
      .map((id) => ({
        chunkId: id,
        documentId: `doc_${id}`,
        position: 0,
        title: id,
        url: undefined,
        sourceType: "docs-crawler",
        content: `content of ${id}`,
      }));
}

function store(
  binding: WeaviateBinding,
  known: string[],
  markIndexed: typeof markRowsIndexed = async () => {},
) {
  return createWeaviateVectorStore(DB, CONFIG, {
    connect: async () => binding,
    markIndexed,
    hydrate: fakeHydrate(known),
  });
}

beforeEach(() => {
  // The warm-up logs its outcome; a test does not need to read it.
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  resetWeaviateBindings();
  vi.restoreAllMocks();
});

describe("id mapping", () => {
  it("restores the dashes of the UUID inside a chunk id, and back", () => {
    const id = "chunk_0123456789abcdef0123456789abcdef";
    expect(chunkIdToUuid(id)).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(uuidToChunkId("01234567-89AB-CDEF-0123-456789ABCDEF")).toBe(id);
  });
  it("refuses an id that is not chunk_ + 32 hex digits", () => {
    expect(() => chunkIdToUuid("chunk_short")).toThrow(/32 hex/);
  });
});

describe("connect options", () => {
  it("derives the gRPC endpoint from the REST URL", () => {
    expect(weaviateConnectOptions({ url: "http://w.test:8080", collection: "C" })).toEqual({
      httpHost: "w.test",
      httpPort: 8080,
      httpSecure: false,
      grpcHost: "w.test",
      grpcPort: 50051,
      grpcSecure: false,
    });
    expect(weaviateConnectOptions({ url: "https://w.test", collection: "C" })).toMatchObject({
      httpPort: 443,
      httpSecure: true,
      grpcPort: 50051,
      grpcSecure: true,
    });
  });
  it("takes an explicit gRPC URL and an HTTP path", () => {
    expect(
      weaviateConnectOptions({
        url: "https://proxy.test/weaviate/",
        grpcUrl: "grpcs://grpc.test:9443",
        collection: "C",
      }),
    ).toMatchObject({
      httpPath: "/weaviate",
      grpcHost: "grpc.test",
      grpcPort: 9443,
      grpcSecure: true,
    });
  });
});

describe("collection", () => {
  it("names itself after the collection", () => {
    expect(store(fakeBinding().binding, []).id).toBe("weaviate:DeskbellChunk");
    expect(weaviateStoreId("Other")).toBe("weaviate:Other");
  });

  it("is created without a vectorizer, on cosine, with ids as single tokens and content searchable", () => {
    const schema = weaviateCollectionSchema("DeskbellChunk") as {
      class: string;
      vectorizer: string;
      vectorIndexConfig: { distance: string };
      properties: Array<Record<string, unknown>>;
    };
    expect(schema.class).toBe("DeskbellChunk");
    expect(schema.vectorizer).toBe("none");
    expect(schema.vectorIndexConfig.distance).toBe("cosine");
    const byName = Object.fromEntries(schema.properties.map((p) => [p.name, p]));
    expect(byName.orgId).toMatchObject({ tokenization: "field", indexSearchable: false });
    expect(byName.content).toMatchObject({ tokenization: "word", indexSearchable: true });
  });

  it("is created once per process when absent, and never when present", async () => {
    const absent = fakeBinding({ exists: false });
    const s = store(absent.binding, []);
    await s.search(ORG, [{ text: "q", embedding: [1] }], { projectId: PROJECT, limit: 8 });
    await s.search(ORG, [{ text: "q", embedding: [1] }], { projectId: PROJECT, limit: 8 });
    expect(absent.calls.created).toHaveLength(1);

    resetWeaviateBindings();
    const present = fakeBinding({ exists: true });
    await store(present.binding, []).search(ORG, [{ text: "q", embedding: [1] }], {
      projectId: PROJECT,
      limit: 8,
    });
    expect(present.calls.created).toHaveLength(0);
  });

  it("does not cache a failed connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const good = fakeBinding({
      nearVector: () => ids(1),
      distances: { [ids(1)[0] as string]: 0.1 },
    });
    const s = createWeaviateVectorStore(DB, CONFIG, {
      connect: async () => {
        attempts++;
        if (attempts === 1) throw new Error("refused");
        return good.binding;
      },
      markIndexed: async () => {},
      hydrate: fakeHydrate(ids(1)),
    });
    // Construction's warm-up attempt fails and is logged, not thrown.
    await new Promise((r) => setImmediate(r));
    const hits = await s.search(ORG, [{ text: "q", embedding: [1] }], {
      projectId: PROJECT,
      limit: 8,
    });
    expect(attempts).toBe(2);
    expect(hits.map((h) => h.chunkId)).toEqual(ids(1));
  });
});

describe("search — single query, vector mode", () => {
  it("asks for limit under the tenant filter with distance, keeps Weaviate's order, scores from distance, hydrates from the rows", async () => {
    const [a, b, c] = ids(3) as [string, string, string];
    const fake = fakeBinding({
      nearVector: () => [b, a, c],
      distances: { [a]: 0.1, [b]: 0.2, [c]: 0.3 },
    });
    const hits = await store(fake.binding, [a, b, c]).search(
      ORG,
      [{ text: "how do I", embedding: [0.1, 0.2] }],
      { projectId: PROJECT, limit: 8 },
    );
    expect(fake.calls.nearVector).toHaveLength(1);
    expect(fake.calls.nearVector[0]?.opts).toMatchObject({
      limit: 8,
      filters: {
        and: [
          { property: "orgId", equal: ORG },
          { property: "projectId", equal: PROJECT },
        ],
      },
      returnMetadata: ["distance"],
    });
    expect(fake.calls.nearVector[0]?.opts.distance).toBeUndefined();
    expect(fake.calls.bm25).toHaveLength(0);
    expect(hits.map((h) => h.chunkId)).toEqual([b, a, c]);
    expect(hits[0]).toMatchObject({ score: 0.8, title: b, content: `content of ${b}` });
    expect(hits[0]?.score).toBeCloseTo(0.8);
    expect(hits[0]?.fused).toBeUndefined();
  });

  it("drops a candidate whose row is gone", async () => {
    const [a, gone] = ids(2) as [string, string];
    const fake = fakeBinding({ nearVector: () => [gone, a], distances: { [a]: 0.5, [gone]: 0.1 } });
    const hits = await store(fake.binding, [a]).search(ORG, [{ text: "q", embedding: [1] }], {
      projectId: PROJECT,
      limit: 8,
    });
    expect(hits.map((h) => h.chunkId)).toEqual([a]);
  });

  it("turns a similarity floor into a distance ceiling and floors again on the returned score", async () => {
    const [a, b, c] = ids(3) as [string, string, string];
    const fake = fakeBinding({ nearVector: () => [a, b, c], distances: { [a]: 0.1, [b]: 0.7 } });
    const hits = await store(fake.binding, [a, b, c]).search(ORG, [{ text: "q", embedding: [1] }], {
      projectId: PROJECT,
      limit: 8,
      minScore: 0.5,
    });
    expect(fake.calls.nearVector[0]?.opts.distance).toBeCloseTo(0.5);
    // b is under the floor; c came back without a distance, which is never floored (spec §5).
    expect(hits.map((h) => h.chunkId)).toEqual([a, c]);
    expect(hits[1]?.score).toBeNull();
  });
});

describe("search — pooled path", () => {
  it("runs both legs per variant in hybrid mode, fuses by reciprocal rank, scores the pool in one filtered call", async () => {
    const [a, b, c, d] = ids(4) as [string, string, string, string];
    const fake = fakeBinding({
      nearVector: () => [a, b],
      bm25: (q) => (q === "canonical" ? [b, c] : [d]),
      distances: { [a]: 0.1, [b]: 0.2, [c]: 0.3, [d]: 0.4 },
    });
    const hits = await store(fake.binding, [a, b, c, d]).search(
      ORG,
      [
        { text: "canonical", embedding: [1] },
        { text: "variant", embedding: [2] },
      ],
      { projectId: PROJECT, limit: 8, mode: "hybrid", legDepth: 10 },
    );
    // Two vector legs, two lexical legs, then ONE scoring call for the canonical query.
    expect(fake.calls.bm25).toHaveLength(2);
    expect(fake.calls.nearVector).toHaveLength(3);
    expect(fake.calls.nearVector[0]?.opts).toMatchObject({ limit: 10 });
    expect(fake.calls.bm25[0]?.opts).toMatchObject({ limit: 10, queryProperties: ["content"] });
    const scoring = fake.calls.nearVector[2] as NonNullable<(typeof fake.calls.nearVector)[2]>;
    expect(scoring.vector).toEqual([1]);
    expect(scoring.opts).toMatchObject({ limit: 4, returnMetadata: ["distance"] });
    const restricted = (scoring.opts.filters as { and: Array<{ ids?: string[] }> }).and.find(
      (f) => f.ids,
    );
    expect(restricted?.ids?.map(uuidToChunkId).sort()).toEqual([a, b, c, d].sort());

    // b: rank 2 on the vector leg, rank 1 on the lexical leg → best rrf 1/61, both legs.
    const byId = Object.fromEntries(hits.map((h) => [h.chunkId, h]));
    expect(byId[b]?.fused).toEqual({
      score: 1 / 61,
      rank: 1,
      variant: 0,
      legs: ["vector", "lexical"],
    });
    expect(byId[a]?.fused).toMatchObject({ rank: 1, variant: 0, legs: ["vector"] });
    expect(byId[d]?.fused).toMatchObject({ rank: 1, variant: 1, legs: ["lexical"] });
    // Fused order, ties to the earlier variant: a (v0 r1) before d (v1 r1).
    expect(hits.map((h) => h.chunkId).indexOf(a)).toBeLessThan(
      hits.map((h) => h.chunkId).indexOf(d),
    );
    // Cosine is to the canonical query, from the store's distance.
    expect(byId[d]?.score).toBeCloseTo(0.6);
  });

  it("skips the lexical leg for a question with no lexemes", async () => {
    const fake = fakeBinding({
      nearVector: () => ids(1),
      distances: { [ids(1)[0] as string]: 0.5 },
    });
    await store(fake.binding, ids(1)).search(
      ORG,
      [
        { text: "?", embedding: [1] },
        { text: "   ", embedding: [2] },
      ],
      { projectId: PROJECT, limit: 8, mode: "hybrid" },
    );
    expect(fake.calls.bm25.map((c) => c.query)).toEqual(["?"]);
  });

  it("multi-query in vector mode never touches BM25, and slices to limit after ordering", async () => {
    const all = ids(5);
    const fake = fakeBinding({
      nearVector: (v) => (v[0] === 1 ? all.slice(0, 3) : all.slice(2)),
      distances: Object.fromEntries(all.map((id, i) => [id, 0.1 + i * 0.1])),
    });
    const hits = await store(fake.binding, all).search(
      ORG,
      [
        { text: "a", embedding: [1] },
        { text: "b", embedding: [2] },
      ],
      { projectId: PROJECT, limit: 2, mode: "vector" },
    );
    expect(fake.calls.bm25).toHaveLength(0);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.fused?.legs.join() === "vector")).toBe(true);
  });

  it("returns nothing when no leg nominates anything, without scoring or hydrating", async () => {
    const fake = fakeBinding();
    const hydrate = vi.fn(fakeHydrate([]));
    const s = createWeaviateVectorStore(DB, CONFIG, {
      connect: async () => fake.binding,
      markIndexed: async () => {},
      hydrate,
    });
    const hits = await s.search(ORG, [{ text: "a", embedding: [1] }], {
      projectId: PROJECT,
      limit: 8,
      mode: "hybrid",
    });
    expect(hits).toEqual([]);
    expect(hydrate).not.toHaveBeenCalled();
    expect(fake.calls.nearVector).toHaveLength(1);
  });
});

describe("upsert", () => {
  const item = (id: string) => ({
    chunkId: id,
    documentId: "doc_1",
    projectId: PROJECT,
    position: 0,
    content: "text",
    embedding: [0.1, 0.2],
    embeddingModel: "m",
    embeddingVersion: 3,
  });

  it("writes the object under the chunk's UUID first, then marks the rows as indexed here", async () => {
    const fake = fakeBinding();
    const order: string[] = [];
    const marked: Array<{ orgId: string; storeId: string; ids: string[] }> = [];
    const original = fake.binding.client.collections.get;
    fake.binding.client.collections.get = (name) => {
      const col = original(name);
      const insertMany = col.data.insertMany.bind(col.data);
      col.data.insertMany = async (batch) => {
        order.push("weaviate");
        return insertMany(batch);
      };
      return col;
    };
    const [id] = ids(1) as [string];
    await store(fake.binding, [], async (_db, orgId, storeId, items) => {
      order.push("rows");
      marked.push({ orgId, storeId, ids: items.map((i) => i.chunkId) });
    }).upsert(ORG, [item(id)]);
    expect(order).toEqual(["weaviate", "rows"]);
    expect(marked).toEqual([{ orgId: ORG, storeId: "weaviate:DeskbellChunk", ids: [id] }]);
    expect(fake.calls.inserted).toEqual([
      {
        id: chunkIdToUuid(id),
        properties: {
          chunkId: id,
          orgId: ORG,
          projectId: PROJECT,
          documentId: "doc_1",
          position: 0,
          content: "text",
          embeddingVersion: 3,
        },
        vectors: [0.1, 0.2],
      },
    ]);
  });

  it("does nothing for an empty batch", async () => {
    const fake = fakeBinding();
    const markIndexed = vi.fn(async () => {});
    await store(fake.binding, [], markIndexed).upsert(ORG, []);
    expect(markIndexed).not.toHaveBeenCalled();
    expect(fake.calls.inserted).toHaveLength(0);
  });

  it("reports a partial batch failure with its first message, and never marks the rows", async () => {
    const fake = fakeBinding({ insertErrors: { 0: { message: "vector lengths don't match" } } });
    const markIndexed = vi.fn(async () => {});
    await expect(
      store(fake.binding, [], markIndexed).upsert(ORG, [item(ids(1)[0] as string)]),
    ).rejects.toThrow(/1 of 1 objects failed.*vector lengths/);
    expect(markIndexed).not.toHaveBeenCalled();
  });

  it("marks rows per (model, generation) with the vector cleared", async () => {
    const [a, b, c] = ids(3) as [string, string, string];
    const statements: Array<{ set: Record<string, unknown>; where: unknown }> = [];
    const db = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            statements.push({ set: values, where });
          },
        }),
      }),
    } as unknown as Database;
    await markRowsIndexed(db, ORG, weaviateStoreId("C"), [
      item(a),
      { ...item(b), embeddingVersion: 4 },
      item(c),
    ]);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.set).toEqual({
      embedding: null,
      embeddingModel: "m",
      embeddingVersion: 3,
      vectorStore: "weaviate:C",
    });
    expect(statements[1]?.set).toMatchObject({ embeddingVersion: 4 });
  });
});

describe("deleteByDocument", () => {
  it("deletes under an org AND document filter", async () => {
    const fake = fakeBinding();
    await store(fake.binding, []).deleteByDocument(ORG, "doc_9");
    expect(fake.calls.deleted).toEqual([
      {
        and: [
          { property: "orgId", equal: ORG },
          { property: "documentId", equal: "doc_9" },
        ],
      },
    ]);
  });
});

describe("sync helpers", () => {
  it("walks the whole collection page by page with a cursor, unfiltered", async () => {
    const all = ids(5);
    const fake = fakeBinding({ fetchPages: [all.slice(0, 2), all.slice(2, 4), all.slice(4)] });
    const pages: string[][] = [];
    for await (const page of listWeaviateChunks(CONFIG, {
      connect: async () => fake.binding,
      pageSize: 2,
    })) {
      pages.push(page.map((p) => p.chunkId));
    }
    expect(pages).toEqual([all.slice(0, 2), all.slice(2, 4), all.slice(4)]);
    expect(fake.calls.fetchObjects[0]).toEqual({
      limit: 2,
      returnProperties: ["chunkId", "orgId"],
    });
    expect(fake.calls.fetchObjects[1]).toMatchObject({ after: chunkIdToUuid(all[1] as string) });
    expect(fake.calls.fetchObjects).toHaveLength(3);
  });

  it("prunes by id in org-scoped batches", async () => {
    const fake = fakeBinding();
    const all = ids(150);
    await deleteFromWeaviate(CONFIG, ORG, all, { connect: async () => fake.binding });
    expect(fake.calls.deleted).toHaveLength(2);
    expect(fake.calls.deleted[0]).toEqual({
      and: [
        { property: "orgId", equal: ORG },
        { property: "chunkId", containsAny: all.slice(0, 100) },
      ],
    });
  });
});

/** Compile-time: the driver's result is the shared contract. */
const _typed: (s: VectorStore) => Promise<ScoredChunk[]> = (s) =>
  s.search(ORG, [], { projectId: PROJECT, limit: 1 });
void _typed;
