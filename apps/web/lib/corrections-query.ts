import { chunks, type Database, documents, gapClusters, sources } from "@deskbell/db";
import { CORRECTIONS_SOURCE_TYPE, newId } from "@deskbell/shared";
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { correctionAnswer } from "./corrections";

/**
 * Reads and the one write that must be shared (spec: corrections-source):
 * the project's corrections source, made on first use. Every query is
 * scoped to the org and project (D12).
 */

export interface CorrectionPair {
  documentId: string;
  question: string;
  answer: string;
  updatedAt: Date;
  /** Chunks written and embedded — "ready" once every chunk has a vector. */
  indexing: "pending" | "ready";
  /** The gap cluster this answers, when it was written from one. */
  cluster: { id: string; label: string; status: "open" | "resolved" } | null;
}

type Project = { id: string; orgId: string };

/**
 * The project's corrections source, created if missing. The partial unique
 * index on (project_id) where type = 'corrections' makes the insert a no-op
 * when another save got there first; the read after it returns whichever
 * row won.
 */
export async function ensureCorrectionsSource(
  db: Database,
  project: Project,
): Promise<{ id: string }> {
  const scope = and(
    eq(sources.orgId, project.orgId),
    eq(sources.projectId, project.id),
    eq(sources.type, CORRECTIONS_SOURCE_TYPE),
  );
  const existing = await db.select({ id: sources.id }).from(sources).where(scope).limit(1);
  if (existing[0]) return existing[0];
  await db
    .insert(sources)
    .values({
      id: newId("src"),
      orgId: project.orgId,
      projectId: project.id,
      type: CORRECTIONS_SOURCE_TYPE,
      config: {},
      status: "ready",
    })
    .onConflictDoNothing();
  const [created] = await db.select({ id: sources.id }).from(sources).where(scope).limit(1);
  if (!created) throw new Error("Could not create the corrections source");
  return created;
}

/** Every answer in the project, newest first, with its cluster and indexing state. */
export async function loadCorrections(db: Database, project: Project): Promise<CorrectionPair[]> {
  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      content: documents.content,
      updatedAt: documents.updatedAt,
      clusterId: gapClusters.id,
      clusterLabel: gapClusters.label,
      clusterStatus: gapClusters.status,
    })
    .from(documents)
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .leftJoin(
      gapClusters,
      and(eq(gapClusters.correctionDocumentId, documents.id), eq(gapClusters.orgId, project.orgId)),
    )
    .where(
      and(
        eq(documents.orgId, project.orgId),
        eq(sources.orgId, project.orgId),
        eq(sources.projectId, project.id),
        eq(sources.type, CORRECTIONS_SOURCE_TYPE),
      ),
    )
    .orderBy(desc(documents.updatedAt));
  if (rows.length === 0) return [];

  // Written vs indexed, per document: a count of the store column skips the
  // rows no store has yet (spec: vector-store-single-home).
  const counts = await db
    .select({
      documentId: chunks.documentId,
      written: count(chunks.id),
      embedded: count(chunks.vectorStore),
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.orgId, project.orgId),
        inArray(
          chunks.documentId,
          rows.map((r) => r.documentId),
        ),
      ),
    )
    .groupBy(chunks.documentId);
  const byDocument = new Map(counts.map((c) => [c.documentId, c]));

  return rows.map((r) => {
    const c = byDocument.get(r.documentId);
    return {
      documentId: r.documentId,
      question: r.title,
      answer: correctionAnswer(r.title, r.content),
      updatedAt: r.updatedAt,
      indexing: c && c.written > 0 && c.embedded === c.written ? "ready" : "pending",
      cluster:
        r.clusterId && r.clusterLabel && r.clusterStatus
          ? { id: r.clusterId, label: r.clusterLabel, status: r.clusterStatus }
          : null,
    };
  });
}

/** The answers behind a set of clusters' pointers, for the gaps page. */
export async function loadCorrectionsByIds(
  db: Database,
  project: Project,
  documentIds: string[],
): Promise<Map<string, { documentId: string; question: string; answer: string }>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db
    .select({ documentId: documents.id, title: documents.title, content: documents.content })
    .from(documents)
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(
      and(
        eq(documents.orgId, project.orgId),
        eq(sources.projectId, project.id),
        eq(sources.type, CORRECTIONS_SOURCE_TYPE),
        inArray(documents.id, documentIds),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.documentId,
      { documentId: r.documentId, question: r.title, answer: correctionAnswer(r.title, r.content) },
    ]),
  );
}
