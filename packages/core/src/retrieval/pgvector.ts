import { chunks, type Database, documents, sources } from "@deskbell/db";
import { and, asc, cosineDistance, eq, gt, isNotNull, sql } from "drizzle-orm";
import { hydrateAndScore } from "./hydrate";
import { type CandidateOrder, orderCandidates } from "./ordering";
import {
  type FusedDiagnostics,
  RETRIEVAL_DEFAULTS,
  type ScoredChunk,
  type SearchQuery,
  type VectorStore,
} from "./vector-store";

/**
 * The pgvector driver — the default and the only one self-hosters need (D13;
 * D11 — Postgres-only bar).
 *
 * Two execution paths, one contract:
 *
 * - A single-query vector search (the shipped default) runs the plain
 *   single-statement query — the behaviour retrieval has always had.
 * - Multi-query and/or hybrid search runs inside ONE REPEATABLE READ read-only
 *   transaction: per query, a skinny leg statement returns ids and ranks
 *   (vector leg, plus the lexical leg in hybrid mode, fused by reciprocal
 *   rank in SQL); the pooled union is deduplicated in TypeScript and then
 *   hydrated + cosine-scored against the canonical question in one final
 *   statement in the same transaction. One transaction is one snapshot, which
 *   is what makes pooling across statements safe against a concurrent re-sync
 *   deleting and re-minting chunk rows (spec: hybrid-retrieval §2–§3).
 *
 * All predicates sit on chunks (org_id, project_id — spec §0); the documents
 * join exists only to hydrate display fields for survivors. The union is
 * never pruned on fusion scores before the scoring pass — fusion scores
 * cluster too tightly to be a safe pre-filter; leg depth (a rank cut) is the
 * only candidate-stage narrowing.
 */

/** RRF constant (spec §2). Inline in the SQL below — it cannot be a bind parameter. */
const RRF_K = 60;
/** What this driver writes to `chunks.vector_store` (spec: vector-store-single-home). */
export const PGVECTOR_STORE_ID = "pgvector";

interface LegRow {
  id: string;
  rrf: string | number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function createPgVectorStore(db: Database): VectorStore {
  /**
   * Whether hnsw.iterative_scan exists on this server (pgvector >= 0.8).
   * Probed once: SET LOCAL on an unknown GUC would abort the transaction, so
   * the setting is applied only where the probe found it.
   */
  let iterativeScan: boolean | undefined;

  async function probeIterativeScan(): Promise<boolean> {
    if (iterativeScan !== undefined) return iterativeScan;
    const result = await db.execute(
      sql`SELECT 1 FROM pg_settings WHERE name = 'hnsw.iterative_scan'`,
    );
    iterativeScan = result.rows.length > 0;
    return iterativeScan;
  }

  /**
   * §0.4 watch item: a mid-size tenant on the ANN path can be starved by
   * neighbours it cannot use. The observable symptom is retrieval returning
   * fewer rows than requested while the tenant holds more — logged so the
   * failure is visible in operation, not just in theory. Skipped when a
   * similarity floor is active, since a floor legitimately shortens results.
   */
  async function warnOnShortfall(
    orgId: string,
    projectId: string,
    returned: number,
    limit: number,
    minScore: number,
  ): Promise<void> {
    if (returned >= limit || minScore > 0) return;
    const [row] = (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM ${chunks} WHERE ${chunks.orgId} = ${orgId} AND ${chunks.projectId} = ${projectId}`,
      )
    ).rows as Array<{ n: number }>;
    if ((row?.n ?? 0) > limit) {
      console.warn(
        `[retrieval] tenant holds ${row?.n} chunks but search returned ${returned} of ` +
          `${limit} requested — possible ANN starvation (spec: hybrid-retrieval §0)`,
      );
    }
  }

  /**
   * Applies the ANN scan settings for the statements that follow in `tx`.
   * The HNSW index is approximate: at pgvector's default depth (40) a scan
   * returns a neighbourhood rather than the nearest neighbours, and the
   * tenant filter — applied AFTER the index scan — thins that neighbourhood
   * further. Neither value can be a bind parameter; both are validated
   * integers/literals interpolated raw (spec: hybrid-retrieval §2).
   */
  async function applyScanSettings(
    tx: Pick<Database, "execute">,
    efSearch: number,
    relaxed: boolean,
  ): Promise<void> {
    await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${clampInt(efSearch, 1, 1000)}`));
    if (relaxed) {
      // Without iterative scan, an HNSW scan that exhausts its candidates
      // under a filter simply returns short (spec §0).
      await tx.execute(sql.raw(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`));
    }
  }

  /**
   * The shipped default: one query, vector leg only, one statement — inside a
   * read-only transaction only so the scan depth can be set for it.
   */
  async function vectorOnly(
    orgId: string,
    query: SearchQuery,
    opts: { projectId: string; limit: number; minScore: number; efSearch: number },
  ): Promise<ScoredChunk[]> {
    const distance = cosineDistance(chunks.embedding, query.embedding);
    const similarity = sql<number>`1 - (${distance})`;
    const relaxed = await probeIterativeScan();
    const rows = await db.transaction(
      async (tx) => {
        // The scan must be at least as deep as the result it is asked for.
        await applyScanSettings(tx, Math.max(opts.efSearch, opts.limit), relaxed);
        return tx
          .select({
            chunkId: chunks.id,
            documentId: chunks.documentId,
            position: chunks.position,
            title: documents.title,
            url: documents.url,
            sourceType: sources.type,
            content: chunks.content,
            score: similarity,
          })
          .from(chunks)
          .innerJoin(documents, eq(chunks.documentId, documents.id))
          .innerJoin(sources, eq(documents.sourceId, sources.id))
          .where(
            and(
              eq(chunks.orgId, orgId),
              eq(chunks.projectId, opts.projectId),
              // A chunk awaiting its embedding has no distance; the vector leg
              // reads only embedded rows.
              isNotNull(chunks.embedding),
              // 0 means OFF — no similarity predicate at all, not "keep positive
              // scores". Zero rows still refuses; zero rows above a threshold no
              // longer does.
              ...(opts.minScore > 0 ? [gt(similarity, opts.minScore)] : []),
            ),
          )
          .orderBy(asc(distance))
          .limit(opts.limit);
      },
      { accessMode: "read only" },
    );
    return rows.map((r) => ({ ...r, url: r.url ?? undefined }));
  }

  return {
    id: PGVECTOR_STORE_ID,

    async search(orgId, queries, opts) {
      if (queries.length === 0) return [];
      const mode = opts.mode ?? RETRIEVAL_DEFAULTS.mode;
      const minScore = opts.minScore ?? RETRIEVAL_DEFAULTS.minScore;
      const canonical = queries[0] as SearchQuery;

      const efSearch = opts.efSearch ?? RETRIEVAL_DEFAULTS.efSearch;

      if (queries.length === 1 && mode === "vector") {
        const hits = await vectorOnly(orgId, canonical, {
          projectId: opts.projectId,
          limit: opts.limit,
          minScore,
          efSearch,
        });
        await warnOnShortfall(orgId, opts.projectId, hits.length, opts.limit, minScore);
        return hits;
      }

      const legDepth = clampInt(opts.legDepth ?? RETRIEVAL_DEFAULTS.legDepth, opts.limit, 1000);
      const relaxed = await probeIterativeScan();

      const pooled = await db.transaction(
        async (tx) => {
          // A leg is a rank cut at legDepth, so the scan must reach at least
          // that deep whatever the configured depth says.
          await applyScanSettings(tx, Math.max(legDepth, efSearch), relaxed);

          const pool = new Map<
            string,
            { score: number; rank: number; variant: number; legs: Set<"vector" | "lexical"> }
          >();

          for (let variant = 0; variant < queries.length; variant++) {
            const q = queries[variant] as SearchQuery;
            const vecParam = JSON.stringify(q.embedding);
            const vec = sql`
              SELECT id, row_number() OVER (ORDER BY dist, id) AS r
              FROM (
                SELECT ${chunks.id} AS id, ${chunks.embedding} <=> ${vecParam}::vector AS dist
                FROM ${chunks}
                WHERE ${chunks.orgId} = ${orgId}
                  AND ${chunks.projectId} = ${opts.projectId}
                  AND ${chunks.embedding} IS NOT NULL
                ORDER BY dist
                LIMIT ${legDepth}
              ) t`;

            let rows: LegRow[];
            let vecRanks: Map<string, number> | undefined;
            let lexRanks: Map<string, number> | undefined;
            if (mode === "hybrid") {
              // The tsquery is an OR of the question's own lexemes, extracted
              // with the SAME config so no user punctuation reaches the
              // tsquery parser; each lexeme is quoted so it cannot be read as
              // an operator. AND-ing (plainto_tsquery) under a
              // stopword-keeping config matches nothing, ever (spec §1).
              // string_agg over zero lexemes is NULL, and a NULL tsquery
              // matches nothing — the leg just stays silent.
              const result = await tx.execute(sql`
                WITH q AS (
                  SELECT to_tsquery('deskbell_search',
                    (SELECT string_agg('''' || replace(lex, '''', '') || '''', ' | ')
                     FROM unnest(tsvector_to_array(to_tsvector('deskbell_search', ${q.text}))) AS lex)
                  ) AS tsq
                ),
                vec AS (${vec}),
                lex AS (
                  SELECT id, row_number() OVER (ORDER BY rank DESC, id) AS r
                  FROM (
                    SELECT c.id AS id, ts_rank_cd(c.search_tsv, q.tsq) AS rank
                    FROM ${chunks} c, q
                    WHERE c.org_id = ${orgId}
                      AND c.project_id = ${opts.projectId}
                      AND q.tsq IS NOT NULL
                      AND c.search_tsv @@ q.tsq
                    ORDER BY rank DESC, c.id
                    LIMIT ${legDepth}
                  ) t
                )
                SELECT COALESCE(vec.id, lex.id) AS id,
                       COALESCE(1.0/(${sql.raw(String(RRF_K))} + vec.r), 0)
                         + COALESCE(1.0/(${sql.raw(String(RRF_K))} + lex.r), 0) AS rrf,
                       vec.r AS vec_rank, lex.r AS lex_rank
                FROM vec FULL OUTER JOIN lex USING (id)
                ORDER BY rrf DESC, id
                LIMIT ${legDepth}`);
              const legRows = result.rows as unknown as Array<
                LegRow & { vec_rank: string | number | null; lex_rank: string | number | null }
              >;
              rows = legRows;
              vecRanks = new Map(
                legRows.filter((r) => r.vec_rank !== null).map((r) => [r.id, Number(r.vec_rank)]),
              );
              lexRanks = new Map(
                legRows.filter((r) => r.lex_rank !== null).map((r) => [r.id, Number(r.lex_rank)]),
              );
            } else {
              const result = await tx.execute(sql`
                WITH vec AS (${vec})
                SELECT id, 1.0/(${sql.raw(String(RRF_K))} + r) AS rrf
                FROM vec ORDER BY r LIMIT ${legDepth}`);
              rows = result.rows as unknown as LegRow[];
            }

            rows.forEach((row, index) => {
              const rank = index + 1;
              const rrf = Number(row.rrf);
              const legs: Array<"vector" | "lexical"> =
                mode === "hybrid"
                  ? [
                      ...(vecRanks?.has(row.id) ? (["vector"] as const) : []),
                      ...(lexRanks?.has(row.id) ? (["lexical"] as const) : []),
                    ]
                  : ["vector"];
              const existing = pool.get(row.id);
              if (!existing) {
                pool.set(row.id, { score: rrf, rank, variant, legs: new Set(legs) });
                return;
              }
              for (const leg of legs) existing.legs.add(leg);
              existing.score = Math.max(existing.score, rrf);
              // Earlier variants win ties: queries[0] is the canonical
              // question, the one guaranteed-faithful reading of what was
              // asked.
              if (rank < existing.rank) {
                existing.rank = rank;
                existing.variant = variant;
              }
            });
          }

          if (pool.size === 0) return [];

          // Hydration + the single scoring pass (spec §3): cosine to the
          // CANONICAL question for every pooled candidate, in the same
          // snapshot the legs read.
          const hydrated = await hydrateAndScore(
            tx,
            orgId,
            opts.projectId,
            [...pool.keys()],
            canonical.embedding,
          );

          return hydrated.map((r): ScoredChunk => {
            const f = pool.get(r.chunkId) as NonNullable<ReturnType<typeof pool.get>>;
            const fused: FusedDiagnostics = {
              score: f.score,
              rank: f.rank,
              variant: f.variant,
              legs: [...f.legs],
            };
            return { ...r, fused };
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

      // The floor applies to candidates that HAVE a score; null is "no
      // embedding yet", never "unrelated", and is not floorable (spec §5).
      const floored =
        minScore > 0 ? pooled.filter((c) => c.score === null || c.score > minScore) : pooled;
      const ordered = orderCandidates(floored, "fused" satisfies CandidateOrder).slice(
        0,
        opts.limit,
      );
      await warnOnShortfall(orgId, opts.projectId, ordered.length, opts.limit, minScore);
      return ordered;
    },

    async upsert(orgId, items) {
      if (items.length === 0) return;
      await db
        .insert(chunks)
        .values(
          items.map((c) => ({
            id: c.chunkId,
            orgId,
            documentId: c.documentId,
            projectId: c.projectId,
            position: c.position,
            content: c.content,
            embedding: c.embedding,
            embeddingModel: c.embeddingModel,
            embeddingVersion: c.embeddingVersion,
            vectorStore: PGVECTOR_STORE_ID,
          })),
        )
        .onConflictDoUpdate({
          target: chunks.id,
          // Identity columns (document, project, position) stay as inserted —
          // a re-embed changes the vector, never where the chunk belongs.
          // The vector and the mark that says where it is land together
          // (spec: vector-store-single-home).
          set: {
            content: sql`excluded.content`,
            embedding: sql`excluded.embedding`,
            embeddingModel: sql`excluded.embedding_model`,
            embeddingVersion: sql`excluded.embedding_version`,
            vectorStore: sql`excluded.vector_store`,
          },
        });
    },

    // The index IS the chunks table: the ingest transaction that replaced
    // the document's rows already removed them from it, so there is nothing
    // left for the driver to forget (spec: weaviate-vector-store).
    async deleteByDocument() {},
  };
}
