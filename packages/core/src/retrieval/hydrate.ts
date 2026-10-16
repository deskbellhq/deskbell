import { chunks, type Database, documents, sources } from "@deskbell/db";
import { and, cosineDistance, eq, inArray, sql } from "drizzle-orm";
import type { ScoredChunk } from "./vector-store";

/**
 * Anything that can run a SELECT: the database, or a transaction inside it.
 * The pgvector driver hydrates inside the snapshot its legs read; a driver
 * whose candidates come from elsewhere hydrates on the plain connection.
 */
export type Queryable = Pick<Database, "select">;

/** What retrieval shows and cites — everything on a chunk except its score. */
export type HydratedChunk = Omit<ScoredChunk, "fused" | "score">;

/**
 * Display fields for candidate ids nominated elsewhere (spec:
 * vector-store-single-home): title, url, source type, content — the rows of
 * record, whichever index holds the vector. Ids without a row are simply
 * absent from the result: a candidate an index still remembers after its
 * row was replaced never reaches the answer. Org- and project-scoped like
 * every retrieval statement (D12): an id from another tenant hydrates to
 * nothing.
 */
export async function hydrateChunks(
  db: Queryable,
  orgId: string,
  projectId: string,
  chunkIds: string[],
): Promise<HydratedChunk[]> {
  if (chunkIds.length === 0) return [];
  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      position: chunks.position,
      title: documents.title,
      url: documents.url,
      sourceType: sources.type,
      content: chunks.content,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(
      and(eq(chunks.orgId, orgId), eq(chunks.projectId, projectId), inArray(chunks.id, chunkIds)),
    );
  return rows.map((r) => ({ ...r, url: r.url ?? undefined }));
}

/**
 * Hydration + the single scoring pass for the driver whose vectors are in
 * the rows (spec: hybrid-retrieval §3, §5): display fields and cosine to the
 * CANONICAL query from `chunks.embedding`, in one statement, inside the
 * snapshot the legs read. Same absence rule and scoping as `hydrateChunks`.
 */
export async function hydrateAndScore(
  db: Queryable,
  orgId: string,
  projectId: string,
  chunkIds: string[],
  canonicalEmbedding: number[],
): Promise<Array<Omit<ScoredChunk, "fused">>> {
  if (chunkIds.length === 0) return [];
  const distance = cosineDistance(chunks.embedding, canonicalEmbedding);
  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      position: chunks.position,
      title: documents.title,
      url: documents.url,
      sourceType: sources.type,
      content: chunks.content,
      score: sql<
        number | null
      >`CASE WHEN ${chunks.embedding} IS NULL THEN NULL ELSE 1 - (${distance}) END`,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(
      and(eq(chunks.orgId, orgId), eq(chunks.projectId, projectId), inArray(chunks.id, chunkIds)),
    );
  return rows.map((r) => ({ ...r, url: r.url ?? undefined }));
}
