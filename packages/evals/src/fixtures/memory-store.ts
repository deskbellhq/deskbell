import {
  RETRIEVAL_DEFAULTS,
  type ScoredChunk,
  type SearchQuery,
  type VectorStore,
} from "@deskbell/core";

export interface MemoryChunk {
  chunkId: string;
  documentId: string;
  title: string;
  url?: string;
  content: string;
  embedding: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] as number) * (b[i] as number);
  return dot;
}

/**
 * An in-memory VectorStore, which is the whole point of retrieval sitting
 * behind an interface (D13): the fixture needs no Postgres, and CI needs no
 * database service to run the harness.
 *
 * "hybrid" mode degrades to the vector leg here — the fixture measures DRIFT,
 * not hybrid quality; lexical ranking only means anything against a real
 * Postgres corpus, so pretending to implement it would put a number on
 * nothing. Multi-query pooling IS implemented (same semantics as the real
 * driver: per-variant rank lists, pooled by best rank with the canonical
 * variant winning ties, scored once against the canonical query).
 */
export function createMemoryVectorStore(chunks: MemoryChunk[]): VectorStore {
  const store = [...chunks];
  const RRF_K = 60;

  function rankFor(query: SearchQuery, legDepth: number) {
    return (
      store
        .map((c) => ({ chunkId: c.chunkId, similarity: cosine(query.embedding, c.embedding) }))
        // Tie-break on chunkId so equal scores order the same way every run.
        .sort((a, b) => b.similarity - a.similarity || a.chunkId.localeCompare(b.chunkId))
        .slice(0, legDepth)
    );
  }

  return {
    async search(_orgId, queries, opts) {
      if (queries.length === 0) return [];
      const minScore = opts.minScore ?? RETRIEVAL_DEFAULTS.minScore;
      const canonical = queries[0] as SearchQuery;
      const hydrate = (chunkId: string): Omit<ScoredChunk, "score" | "fused"> => {
        const c = store.find((s) => s.chunkId === chunkId) as MemoryChunk;
        return {
          chunkId: c.chunkId,
          documentId: c.documentId,
          position: null,
          title: c.title,
          url: c.url,
          content: c.content,
        };
      };

      if (queries.length === 1) {
        // The shipped default path: single query, plain cosine ranking —
        // byte-identical to the store's original behaviour.
        return rankFor(canonical, store.length)
          .filter((c) => minScore <= 0 || c.similarity > minScore)
          .slice(0, opts.limit)
          .map((c) => ({ ...hydrate(c.chunkId), score: c.similarity }));
      }

      const legDepth = opts.legDepth ?? RETRIEVAL_DEFAULTS.legDepth;
      const pool = new Map<string, { score: number; rank: number; variant: number }>();
      queries.forEach((query, variant) => {
        rankFor(query, legDepth).forEach((row, index) => {
          const rank = index + 1;
          const rrf = 1 / (RRF_K + rank);
          const existing = pool.get(row.chunkId);
          if (!existing) {
            pool.set(row.chunkId, { score: rrf, rank, variant });
            return;
          }
          existing.score = Math.max(existing.score, rrf);
          if (rank < existing.rank) {
            existing.rank = rank;
            existing.variant = variant;
          }
        });
      });

      return [...pool.entries()]
        .map(([chunkId, f]): ScoredChunk => {
          const base = hydrate(chunkId);
          const score = cosine(
            canonical.embedding,
            (store.find((s) => s.chunkId === chunkId) as MemoryChunk).embedding,
          );
          return { ...base, score, fused: { ...f, legs: ["vector"] } };
        })
        .filter((c) => minScore <= 0 || c.score === null || c.score > minScore)
        .sort(
          (a, b) =>
            (a.fused?.rank ?? 0) - (b.fused?.rank ?? 0) ||
            (a.fused?.variant ?? 0) - (b.fused?.variant ?? 0) ||
            a.chunkId.localeCompare(b.chunkId),
        )
        .slice(0, opts.limit);
    },

    id: "memory",
    async upsert() {
      throw new Error("the fixture store is read-only — build it with createMemoryVectorStore");
    },
    async deleteByDocument() {
      throw new Error("the fixture store is read-only — build it with createMemoryVectorStore");
    },
  };
}
