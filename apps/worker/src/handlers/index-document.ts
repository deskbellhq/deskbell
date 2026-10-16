import {
  type ChunkOptions,
  chunkText,
  detectInjectionSignals,
  type VectorStore,
} from "@deskbell/core";
import { chunks, type Database } from "@deskbell/db";
import { type EmbedChunksJob, newId, QUEUE_EMBED_CHUNKS } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

/**
 * The part of ingestion that starts once a document's text is known: chunk
 * it, flag what looks like instructions, replace the stored chunks, and ask
 * for embeddings. Shared by the connector path (ingest.source) and the
 * dashboard path (ingest.document, spec: corrections-source), so the two
 * cannot drift on positions, flagging or the embed hand-off.
 *
 * Dependencies are injected so the loop is testable without Postgres, the
 * way the re-index handler does it.
 */

export interface NewChunkRow {
  id: string;
  orgId: string;
  documentId: string;
  projectId: string;
  /** 0-based index within the document — not backfillable (spec: hybrid-retrieval §1). */
  position: number;
  content: string;
  /** null when nothing fired, so "flagged" stays a cheap IS NOT NULL. */
  injectionSignals: string[] | null;
}

export interface IndexDeps {
  chunk(content: string): string[];
  /**
   * Drop the document's chunks and write these — retries land on the same
   * rows. Also tells the vector store the old rows are gone: a driver with
   * its own index forgets them here (spec: weaviate-vector-store).
   */
  replaceChunks(scope: { orgId: string; documentId: string }, rows: NewChunkRow[]): Promise<void>;
  enqueueEmbed(job: EmbedChunksJob): Promise<void>;
}

export interface IndexDocumentInput {
  orgId: string;
  sourceId: string;
  documentId: string;
  projectId: string;
  content: string;
}

export interface IndexDocumentResult {
  chunks: number;
  flagged: number;
}

export async function indexDocument(
  deps: IndexDeps,
  input: IndexDocumentInput,
): Promise<IndexDocumentResult> {
  const pieces = deps.chunk(input.content);
  let flagged = 0;
  // Flag, never clean or drop (connectors AGENTS rule): a flagged chunk
  // stays in the corpus and stays retrievable. Operator-written text gets
  // the same look — content is data whichever door it came through.
  const rows = pieces.map((content, index): NewChunkRow => {
    const signals = detectInjectionSignals(content);
    if (signals.length > 0) flagged++;
    return {
      id: newId("chunk"),
      orgId: input.orgId,
      documentId: input.documentId,
      projectId: input.projectId,
      position: index,
      content,
      injectionSignals: signals.length > 0 ? signals : null,
    };
  });
  await deps.replaceChunks({ orgId: input.orgId, documentId: input.documentId }, rows);
  // Even with nothing to embed: embed.chunks is what flips the source to
  // "ready", and an empty document must not leave it "pending" forever.
  await deps.enqueueEmbed({
    orgId: input.orgId,
    sourceId: input.sourceId,
    documentId: input.documentId,
  });
  return { chunks: rows.length, flagged };
}

export function createIndexDeps(
  db: Database,
  boss: PgBoss,
  vectorStore: VectorStore,
  chunkOptions: ChunkOptions,
): IndexDeps {
  return {
    chunk: (content) => chunkText(content, chunkOptions),
    async replaceChunks({ orgId, documentId }, rows) {
      await db.transaction(async (tx) => {
        await tx
          .delete(chunks)
          .where(and(eq(chunks.documentId, documentId), eq(chunks.orgId, orgId)));
        if (rows.length > 0) await tx.insert(chunks).values(rows);
      });
      // After the transaction, not inside it: the store may be another
      // system, and a failure here must not roll back rows of record. The
      // new rows are not in the index yet (no embedding), and old objects
      // that outlive a failed forget drop out at hydration.
      await vectorStore.deleteByDocument(orgId, documentId);
    },
    async enqueueEmbed(job) {
      await boss.send(QUEUE_EMBED_CHUNKS, job satisfies EmbedChunksJob);
    },
  };
}
