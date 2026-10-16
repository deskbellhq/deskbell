import type { VectorStore } from "@deskbell/core";
import type { createEmbedder } from "@deskbell/core/models";
import { chunks, type Database, documents, sources } from "@deskbell/db";
import type { EmbedChunksJob } from "@deskbell/shared";
import { and, count, eq, isNull, max } from "drizzle-orm";

export const EMBED_SLICE = 64; // belt-and-braces under embedMany's own per-model batching

/**
 * embed.chunks (spec: ingestion-pipeline): embed the document's unindexed
 * chunks and flip the source to "ready" once none remain source-wide.
 * Idempotent: the isNull(vectorStore) filter — the row is marked only after
 * the store has the vector (spec: vector-store-single-home) — makes pg-boss
 * retries safe, and a double "ready" update is harmless.
 */
export async function handleEmbedChunks(
  db: Database,
  vectorStore: VectorStore,
  embedder: ReturnType<typeof createEmbedder>,
  job: EmbedChunksJob,
): Promise<void> {
  const pending = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      projectId: chunks.projectId,
      position: chunks.position,
      content: chunks.content,
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.orgId, job.orgId),
        eq(chunks.documentId, job.documentId),
        isNull(chunks.vectorStore),
      ),
    );

  // Fresh chunks join the org's CURRENT embedding generation — the max version
  // across the org, 1 if it never re-indexed. Left at the column default they
  // would sit permanently "behind" after any re-index, and the reindex
  // predicate could not tell new from stale (spec: ingestion-pipeline).
  const [current] = await db
    .select({ v: max(chunks.embeddingVersion) })
    .from(chunks)
    .where(eq(chunks.orgId, job.orgId));
  const embeddingVersion = current?.v ?? 1;

  for (let i = 0; i < pending.length; i += EMBED_SLICE) {
    const slice = pending.slice(i, i + EMBED_SLICE);
    const embeddings = await embedder.embedMany(slice.map((c) => c.content));
    const items = slice.flatMap((c, idx) => {
      const embedding = embeddings[idx];
      return embedding
        ? [
            {
              chunkId: c.id,
              documentId: c.documentId,
              projectId: c.projectId,
              position: c.position,
              content: c.content,
              embedding,
              embeddingModel: embedder.modelId,
              embeddingVersion,
            },
          ]
        : [];
    });
    await vectorStore.upsert(job.orgId, items);
  }

  const [remaining] = await db
    .select({ n: count() })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(
      and(
        eq(documents.sourceId, job.sourceId),
        eq(chunks.orgId, job.orgId),
        isNull(chunks.vectorStore),
      ),
    );

  if ((remaining?.n ?? 0) === 0) {
    await db
      .update(sources)
      .set({ status: "ready", lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sources.id, job.sourceId), eq(sources.orgId, job.orgId)));
  }
}
