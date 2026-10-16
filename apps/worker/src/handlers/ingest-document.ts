import { chunkOptionsFromEnv, type VectorStore } from "@deskbell/core";
import { type Database, documents, sources } from "@deskbell/db";
import type { IngestDocumentJob } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { createIndexDeps, indexDocument } from "./index-document";

/**
 * ingest.document (spec: corrections-source): re-chunk one document the
 * dashboard already wrote and enqueue its embedding. No connector, no
 * discovery, no hash check — the producer changed the text and says so by
 * sending the job. A document that is gone by the time the job runs was
 * deleted on purpose; that is a log line, not a failure. Throws propagate
 * so pg-boss retries; chunks are replaced, so a retry lands on the same
 * rows.
 */
export async function handleIngestDocument(
  boss: PgBoss,
  db: Database,
  vectorStore: VectorStore,
  job: IngestDocumentJob,
): Promise<void> {
  const [row] = await db
    .select({ content: documents.content, projectId: sources.projectId })
    .from(documents)
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(
      and(
        eq(documents.id, job.documentId),
        eq(documents.orgId, job.orgId),
        eq(documents.sourceId, job.sourceId),
      ),
    );
  if (!row) {
    console.log(`[ingest.document] ${job.documentId}: gone before indexing, nothing to do`);
    return;
  }
  if (row.content === null) {
    console.error(`[ingest.document] ${job.documentId}: no stored text, nothing to index`);
    return;
  }
  // Read per job, not per process, like ingest.source: a changed chunk size
  // applies to the next save without a worker restart.
  const result = await indexDocument(
    createIndexDeps(db, boss, vectorStore, chunkOptionsFromEnv()),
    {
      orgId: job.orgId,
      sourceId: job.sourceId,
      documentId: job.documentId,
      projectId: row.projectId,
      content: row.content,
    },
  );
  console.log(
    `[ingest.document] ${job.documentId}: chunks=${result.chunks} flagged=${result.flagged}`,
  );
}
