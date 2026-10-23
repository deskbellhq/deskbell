/**
 * D13 — retrieval sits behind this interface: the interface is the guarantee,
 * the driver is pluggable. pgvector is the default driver (see ./pgvector) and
 * the only one self-hosters need (D11 — Postgres-only bar). Other engines are
 * opt-in drivers an operator selects because they already run the engine
 * (see ./weaviate); they must NEVER become a self-host dependency.
 */

/** One search the engine issues. `embedding` embeds exactly `text`. */
export interface SearchQuery {
  /** What the lexical leg parses and what diagnostics report. */
  text: string;
  embedding: number[];
}

export interface SearchOptions {
  projectId: string;
  /**
   * Candidates returned after pooling and fusion — the pool handed to final
   * ordering, not the number of chunks the model sees. The engine slices to
   * its answer size after ordering and capping.
   */
  limit: number;
  /**
   * "vector" (default): the semantic leg only — single-query calls behave
   * exactly as retrieval always has. "hybrid": adds the lexical
   * (full-text-search) leg and fuses the two by reciprocal rank
   * (spec: hybrid-retrieval §1–§2).
   */
  mode?: "vector" | "hybrid";
  /**
   * Per-leg candidate depth before fusion — a rank cut, the only legitimate
   * candidate-stage narrowing. Also drives the ANN search depth, whose server
   * default (40) would otherwise silently truncate a deeper leg
   * (spec: hybrid-retrieval §2).
   */
  legDepth?: number;
  /**
   * How many candidates the ANN index examines per query (pgvector's
   * `hnsw.ef_search`). The index is approximate: at the server default (40)
   * it returns a neighbourhood, not the nearest neighbours, and a tenant
   * filter applied after the scan narrows it further. Raising it buys
   * exactness for milliseconds; the sweep chooses the value. Ignored by
   * drivers without an approximate index.
   */
  efSearch?: number;
  /**
   * Cosine-similarity floor over candidates that HAVE a score. Off (0) by
   * default: this floor decides whether we ANSWER, not whether a link is
   * shown, and correct documents routinely score poorly — so a floor
   * calibrated against nothing silently turns answers into refusals before
   * the model is even consulted. The model's NO_GROUNDING contract is the
   * grounding gate. A null score is never floored — null means "no embedding
   * yet", not "unrelated" (D8, spec: grounded-generation, hybrid-retrieval §5).
   */
  minScore?: number;
}

/**
 * How fusion saw a candidate. DIAGNOSTICS ONLY — the fused score's magnitude
 * depends on the RRF constant and on how many legs fired, so nothing may
 * threshold it; the ARRAY ORDER of a search result is the ranking
 * (spec: hybrid-retrieval §5). Absent on a plain single-query vector search.
 */
export interface FusedDiagnostics {
  /** Best reciprocal-rank-fusion value across the variants that saw it. */
  score: number;
  /** Best fused rank (1-based) across variants. */
  rank: number;
  /** Which query achieved that best rank; 0 is the canonical question. */
  variant: number;
  /** Union of the legs that nominated this chunk, across all variants. */
  legs: Array<"vector" | "lexical">;
}

export interface ScoredChunk {
  chunkId: string;
  documentId: string;
  /** 0-based index within the document; null on rows ingested before it existed. */
  position: number | null;
  title: string;
  url?: string;
  /** The connector type of the document's source, e.g. "docs-crawler". */
  sourceType?: string;
  content: string;
  /**
   * Cosine similarity to the CANONICAL query (queries[0]) — the one scale a
   * consumer can reason about. Null when the chunk has no embedding (a
   * lexical-only hit mid-ingest): honest, and it forces the consumer to
   * decide, where 0 would masquerade as "unrelated". NOT monotonic down the
   * array — an exact lexical match can rank high at middling cosine
   * (spec: hybrid-retrieval §5).
   */
  score: number | null;
  fused?: FusedDiagnostics;
}

/**
 * The product's retrieval behaviour. Overridable; never silently different.
 * Every ranking-affecting value here was chosen against the eval harness
 * (spec: retrieval-defaults) or left at the behaviour it replaced: vector
 * mode, single query, one chunk per document, fused order (inert until
 * hybrid or multi-query is on). Sizing knobs are a latency budget, not a
 * quality dial (spec: hybrid-retrieval §3).
 */
export const RETRIEVAL_DEFAULTS = {
  limit: 8,
  minScore: 0,
  mode: "vector",
  multiQuery: false,
  legDepth: 50,
  pool: 24,
  // One chunk per document: top-k over chunks hands a long page one slot
  // per chunk while a one-chunk page gets a single shot, and the answer is
  // usually on the short page. Measured +0.09 recall@8 on the private tuning
  // set at no cost to answer quality (spec: retrieval-defaults).
  maxPerDocument: 1,
  // Chunks the top-ranked document may keep on top of the cap; 1 = off. A
  // long page answers a question about itself only when enough of it arrives.
  // Measured at 3 on the private set: Factuality +7 points over two judged
  // samples, recall@8 unchanged, input tokens +15% (spec: top-document-depth).
  topDocumentChunks: 3,
  order: "fused",
  // The HNSW index is approximate. pgvector's own default (40) lost 0.06
  // recall@8 against an exact scan on the private tuning set; 100 recovered
  // all of it and deeper scans added nothing (spec: retrieval-defaults).
  efSearch: 100,
} as const;

export interface VectorStore {
  /**
   * The store's identity as written to `chunks.vector_store` on every row it
   * indexes: `pgvector`, or `weaviate:<collection>`. A row whose value is not
   * the configured store's id was indexed somewhere else and is waiting for
   * a re-index (spec: vector-store-single-home).
   */
  readonly id: string;
  /**
   * Run every query, pool the candidates, and return them ordered. queries[0]
   * is canonical: `score` is cosine to it, and fused-order ties resolve in
   * its favour. One call is one snapshot — a re-sync deleting chunks between
   * legs must not tear the result (spec: hybrid-retrieval §2).
   * Every call is org-scoped (D12) — there is no unscoped search path.
   */
  search(orgId: string, queries: SearchQuery[], opts: SearchOptions): Promise<ScoredChunk[]>;
  /**
   * Index these vectors, then mark the rows as indexed here — in that order,
   * so a row never claims a vector the store does not have. A vector lives
   * in exactly one store: a driver with its own store leaves (or clears)
   * `chunks.embedding` (spec: vector-store-single-home).
   */
  upsert(
    orgId: string,
    chunks: Array<{
      chunkId: string;
      documentId: string;
      /**
       * Denormalised tenant scope (spec: hybrid-retrieval §0). Required so an
       * upsert that has to INSERT can satisfy the NOT NULL column; retrieval
       * scopes on it without touching sources.
       */
      projectId: string;
      /**
       * 0-based index within the document; null for rows whose position is
       * unknown (pre-migration chunks, fixed by re-syncing the source).
       */
      position: number | null;
      content: string;
      embedding: number[];
      embeddingModel: string;
      /**
       * Which re-index generation produced this vector. Required, not
       * defaulted: an embedding write that cannot state its vintage is
       * exactly what makes a later re-index unable to tell current rows
       * from stale ones (spec: ingestion-pipeline).
       */
      embeddingVersion: number;
    }>,
  ): Promise<void>;
  /**
   * The document's chunk rows are gone; drop whatever the index still holds
   * for them. A no-op for a driver whose index is the chunks table itself;
   * for a driver with its own store this is the delete half of `upsert`
   * (spec: weaviate-vector-store). Org-scoped like everything else (D12).
   */
  deleteByDocument(orgId: string, documentId: string): Promise<void>;
}
