import { createHash } from "node:crypto";
import { connectorRegistry } from "@deskbell/connectors";
import { chunkOptionsFromEnv, type VectorStore } from "@deskbell/core";
import { type Database, documents, sources } from "@deskbell/db";
import {
  CORRECTIONS_SOURCE_TYPE,
  type IngestDocumentJob,
  type IngestSourceJob,
  newId,
  QUEUE_INGEST_DOCUMENT,
} from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { createIndexDeps, indexDocument } from "./index-document";

/**
 * ingest.source (spec: ingestion-pipeline): resolve connector → discover →
 * content-hash dedupe → upsert documents + unembedded chunks → enqueue
 * embed.chunks per changed document. Document identity = (org, source, url);
 * the docs-crawler's externalId IS the normalized URL.
 * Crawl failures mark the source "error" without a pg-boss retry — re-syncs
 * are manual ("Sync now"); stale-document sweep is a follow-up.
 *
 * A corrections source (spec: corrections-source) has no connector: its
 * documents were written in the dashboard and are identified by id, never
 * by URL. Syncing one re-indexes each document through ingest.document.
 */
export async function handleIngestSource(
  boss: PgBoss,
  db: Database,
  vectorStore: VectorStore,
  job: IngestSourceJob,
): Promise<void> {
  const source = await db.query.sources.findFirst({
    where: and(eq(sources.id, job.sourceId), eq(sources.orgId, job.orgId)),
  });
  if (!source) {
    console.error(`[ingest.source] unknown source ${job.sourceId}`);
    return;
  }

  await db
    .update(sources)
    .set({ status: "syncing", updatedAt: new Date() })
    .where(eq(sources.id, source.id));

  try {
    if (source.type === CORRECTIONS_SOURCE_TYPE) {
      const docs = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.orgId, job.orgId), eq(documents.sourceId, source.id)));
      for (const doc of docs) {
        await boss.send(QUEUE_INGEST_DOCUMENT, {
          orgId: job.orgId,
          sourceId: source.id,
          documentId: doc.id,
        } satisfies IngestDocumentJob);
      }
      console.log(`[ingest.source] ${source.id}: corrections, re-indexing ${docs.length}`);
      if (docs.length === 0) {
        await db
          .update(sources)
          .set({ status: "ready", lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(sources.id, source.id));
      }
      return;
    }

    const connector = connectorRegistry.get(source.type);
    if (!connector) throw new Error(`Unknown connector type "${source.type}"`);
    const config = connector.configSchema.parse(source.config);
    // Read per sync, not per process: an operator changing the size and
    // re-syncing gets the new size without restarting the worker.
    const index = createIndexDeps(db, boss, vectorStore, chunkOptionsFromEnv());

    let discovered = 0;
    let changed = 0;
    let flagged = 0;
    let backfilled = 0;

    for await (const doc of connector.discover(config as never)) {
      discovered++;
      const contentHash = createHash("sha256").update(doc.content).digest("hex");
      const existing = await db.query.documents.findFirst({
        where: and(
          eq(documents.orgId, job.orgId),
          eq(documents.sourceId, source.id),
          eq(documents.url, doc.externalId),
        ),
      });
      if (existing && existing.contentHash === contentHash) {
        // Same page as last time. A row from before the page text was kept
        // gets the text written and nothing else — no re-chunk, no embed
        // job — so the sync after the migration is cheap and chunk
        // identity survives it (spec: contextual-chunks).
        if (existing.content === null) {
          await db
            .update(documents)
            .set({ content: doc.content, updatedAt: new Date() })
            .where(eq(documents.id, existing.id));
          backfilled++;
        }
        continue;
      }

      let documentId: string;
      if (existing) {
        documentId = existing.id;
        await db
          .update(documents)
          .set({ title: doc.title, contentHash, content: doc.content, updatedAt: new Date() })
          .where(eq(documents.id, existing.id));
      } else {
        documentId = newId("doc");
        await db.insert(documents).values({
          id: documentId,
          orgId: job.orgId,
          sourceId: source.id,
          url: doc.url ?? doc.externalId,
          title: doc.title,
          contentHash,
          content: doc.content,
        });
      }

      const indexed = await indexDocument(index, {
        orgId: job.orgId,
        sourceId: source.id,
        documentId,
        projectId: source.projectId,
        content: doc.content,
      });
      flagged += indexed.flagged;
      changed++;
    }

    console.log(
      `[ingest.source] ${source.id}: discovered=${discovered} changed=${changed} flagged=${flagged}` +
        (backfilled ? ` page-text-backfilled=${backfilled}` : ""),
    );
    if (changed === 0) {
      // Nothing to embed — the source is as ready as it will get.
      await db
        .update(sources)
        .set({ status: "ready", lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(sources.id, source.id));
    }
  } catch (error) {
    console.error(`[ingest.source] ${source.id} failed:`, error);
    await db
      .update(sources)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(sources.id, source.id));
  }
}
