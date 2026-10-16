import type { VectorStore } from "@deskbell/core";
import { createEmbedder } from "@deskbell/core/models";
import { chunks, type Database, EMBEDDING_DIMENSIONS, projects } from "@deskbell/db";
import type { ReindexEmbeddingsJob } from "@deskbell/shared";
import { and, eq, lt, max } from "drizzle-orm";
import { EMBED_SLICE } from "./embed-chunks";

/**
 * reindex.embeddings (spec: ingestion-pipeline): re-embed every chunk whose
 * embedding_version is behind the target, after an embedding-model change.
 *
 * Resumable by construction: the predicate is "version < target", and every
 * batch it completes advances those rows past the predicate. A crash mid-run
 * loses at most one batch of work; the pg-boss retry continues where it
 * stopped instead of restarting.
 *
 * Throughput, stated because it will bite: pg-boss runs this worker with all
 * defaults, so every queue is strictly serial worker-wide and a full re-index
 * blocks ingestion for its duration. Accepted for now — a re-index is rare,
 * operator-initiated, and the alternative (concurrent embedding writes from
 * two generations) is harder to reason about than a paused sync.
 */

/** What one re-embedding pass needs. Injected so the loop is testable without Postgres. */
export interface ReindexDeps {
  /** Next batch of org-scoped chunks still behind the target version (D12). */
  loadStale(limit: number): Promise<
    Array<{
      id: string;
      documentId: string;
      projectId: string;
      position: number | null;
      content: string;
    }>
  >;
  embedMany(values: string[]): Promise<number[][]>;
  upsert(
    items: Array<{
      chunkId: string;
      documentId: string;
      projectId: string;
      position: number | null;
      content: string;
      embedding: number[];
      embeddingModel: string;
      embeddingVersion: number;
    }>,
  ): Promise<void>;
}

/**
 * Refuse a dimension change rather than half-applying one. The embedding
 * column is vector(EMBEDDING_DIMENSIONS); a model with a different dimension
 * cannot be written into it, and discovering that halfway through leaves the
 * corpus split across two vector spaces — retrieval silently corrupted
 * rather than a job failed. Probed with one throwaway embedding BEFORE any
 * row is touched.
 */
async function assertDimensions(deps: ReindexDeps, job: ReindexEmbeddingsJob): Promise<void> {
  const [probe] = await deps.embedMany(["deskbell dimension probe"]);
  if (!probe || probe.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `reindex refused: "${job.targetModel}" embeds ${probe?.length ?? 0} dimensions but the ` +
        `chunks.embedding column is vector(${EMBEDDING_DIMENSIONS}). Changing dimensions needs ` +
        "a migration of the embedding column first (packages/db/AGENTS.md — never an " +
        "in-place alter), then re-run the re-index. No rows were touched.",
    );
  }
}

export async function runReindex(
  deps: ReindexDeps,
  job: ReindexEmbeddingsJob,
): Promise<{ reembedded: number }> {
  await assertDimensions(deps, job);

  let reembedded = 0;
  for (;;) {
    const batch = await deps.loadStale(EMBED_SLICE);
    if (batch.length === 0) break;

    const embeddings = await deps.embedMany(batch.map((c) => c.content));
    const items = batch.flatMap((c, idx) => {
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
              embeddingModel: job.targetModel,
              embeddingVersion: job.targetVersion,
            },
          ]
        : [];
    });
    // Every upserted row leaves the predicate. If none did, the next
    // loadStale returns the same rows and this loop never ends — fail loudly
    // instead of spinning against a broken embedder.
    if (items.length === 0) {
      throw new Error(
        `reindex stalled: embedder returned no vectors for a batch of ${batch.length} — ` +
          "aborting instead of looping. Completed rows stay advanced; re-run to resume.",
      );
    }
    await deps.upsert(items);
    reembedded += items.length;
  }
  return { reembedded };
}

export function createReindexDeps(
  db: Database,
  vectorStore: VectorStore,
  job: ReindexEmbeddingsJob,
): ReindexDeps {
  // The embedder is built for the job's target model, not whatever the
  // worker's env happens to say by the time the job runs — the job is the
  // record of what was requested.
  const embedder = createEmbedder({
    ...process.env,
    DESKBELL_EMBEDDING_MODEL: job.targetModel,
  });

  const stale = and(eq(chunks.orgId, job.orgId), lt(chunks.embeddingVersion, job.targetVersion));
  return {
    loadStale(limit) {
      // Project scoping reads the denormalised chunks.project_id — the joins
      // through documents→sources are gone (spec: hybrid-retrieval §0).
      const cols = {
        id: chunks.id,
        documentId: chunks.documentId,
        projectId: chunks.projectId,
        position: chunks.position,
        content: chunks.content,
      };
      const where = job.projectId ? and(stale, eq(chunks.projectId, job.projectId)) : stale;
      return db.select(cols).from(chunks).where(where).limit(limit);
    },
    embedMany: (values) => embedder.embedMany(values),
    upsert: (items) => vectorStore.upsert(job.orgId, items),
  };
}

/**
 * Builds the re-index job for one project the way the dashboard does: the
 * target version is the org's current generation plus one unless given, and
 * the model is the one configured unless given. Shared by the CLI and any
 * other producer so "re-index this project" means one thing.
 */
export async function planProjectReindex(
  db: Database,
  projectId: string,
  options: { targetVersion?: number; targetModel?: string } = {},
): Promise<ReindexEmbeddingsJob> {
  const [project] = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error(`no project with id ${projectId}`);

  const [current] = await db
    .select({ v: max(chunks.embeddingVersion) })
    .from(chunks)
    .where(eq(chunks.orgId, project.orgId));

  return {
    orgId: project.orgId,
    projectId: project.id,
    targetModel: options.targetModel ?? createEmbedder().modelId,
    targetVersion: options.targetVersion ?? (current?.v ?? 1) + 1,
  };
}

export async function handleReindexEmbeddings(
  db: Database,
  vectorStore: VectorStore,
  job: ReindexEmbeddingsJob,
): Promise<void> {
  const { reembedded } = await runReindex(createReindexDeps(db, vectorStore, job), job);
  console.log(
    `[reindex.embeddings] org=${job.orgId} → ${job.targetModel} v${job.targetVersion}: ` +
      `${reembedded} chunks re-embedded`,
  );
}
