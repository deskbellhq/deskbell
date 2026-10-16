import {
  conversations,
  type Database,
  gapClusters,
  gapPhrasings,
  gapQuestionSql,
  isGapPredicate,
  messages,
  projects,
  readClusterConfig,
  readGapsConfig,
  readIgnoredTerms,
  stripIgnoredTerms,
} from "@deskbell/db";
import type { GapsCatchupJob } from "@deskbell/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  type AssignResult,
  assignGapCluster,
  type ClusterScope,
  createAssignDeps,
  type Embedder,
} from "./assign-gap-cluster";
import { EMBED_SLICE } from "./embed-chunks";

/**
 * gaps.catchup (spec: gap-clusters): the safety net under the per-message
 * assignment, and what a re-cluster runs.
 *
 * For each project (or the one named), every gap-qualifying message without
 * a cluster is assigned, oldest first so the earliest phrasing becomes a
 * cluster's label, with each slice embedded in one batch — with the project's
 * ignored terms removed, as assignment does. Then wordings recorded while the
 * embedder was unavailable get their vector.
 *
 * Resumable by construction: every assigned message leaves the predicate,
 * so a crash mid-run loses one slice and a retry continues.
 */

export interface CatchupDeps {
  listProjects(): Promise<ClusterScope[]>;
  /** What this project strips from a question before embedding it. */
  ignoredTerms(scope: ClusterScope): Promise<string[]>;
  /** Oldest first: the earliest phrasing labels the cluster. */
  loadUnassigned(
    scope: ClusterScope,
    limit: number,
  ): Promise<Array<{ messageId: string; question: string | null }>>;
  /** One vector per input, or null for all when the embedder fails. */
  embedMany(values: string[]): Promise<Array<number[] | null>>;
  assign(
    scope: ClusterScope,
    messageId: string,
    embedding: number[] | null,
  ): Promise<AssignResult | null>;
  /** Wordings written while the embedder was down, oldest first. */
  loadVectorless(
    scope: ClusterScope,
    limit: number,
  ): Promise<Array<{ id: string; clusterId: string; text: string }>>;
  setPhrasingVector(
    scope: ClusterScope,
    phrasing: { id: string; clusterId: string },
    embedding: number[],
  ): Promise<void>;
}

export interface CatchupSummary {
  projects: number;
  assigned: number;
  created: number;
  healed: number;
}

export async function runCatchup(
  deps: CatchupDeps,
  job: GapsCatchupJob,
  slice = EMBED_SLICE,
): Promise<CatchupSummary> {
  const scopes =
    job.orgId && job.projectId
      ? [{ orgId: job.orgId, projectId: job.projectId }]
      : await deps.listProjects();

  const summary: CatchupSummary = { projects: scopes.length, assigned: 0, created: 0, healed: 0 };
  for (const scope of scopes) {
    const terms = await deps.ignoredTerms(scope);
    for (;;) {
      const batch = await deps.loadUnassigned(scope, slice);
      if (batch.length === 0) break;
      const vectors = await deps.embedMany(
        batch.map((m) => stripIgnoredTerms(m.question?.trim() || "", terms)),
      );
      let assignedInSlice = 0;
      for (const [i, m] of batch.entries()) {
        const result = await deps.assign(scope, m.messageId, vectors[i] ?? null);
        if (!result) continue;
        assignedInSlice += 1;
        if (result.joinedBy === "created") summary.created += 1;
      }
      // Every assignment leaves the predicate. If none did, the next load
      // returns the same rows and this loop never ends — fail loudly instead.
      if (assignedInSlice === 0) {
        throw new Error(
          `gaps.catchup stalled: none of ${batch.length} messages could be assigned in ` +
            `project ${scope.projectId} — aborting instead of looping.`,
        );
      }
      summary.assigned += assignedInSlice;
    }

    // Heal: wordings recorded while the embedder was down. One pass; if
    // nothing gets a vector the embedder is still down and the next hour
    // tries again.
    for (;;) {
      const vectorless = await deps.loadVectorless(scope, slice);
      if (vectorless.length === 0) break;
      const vectors = await deps.embedMany(vectorless.map((p) => stripIgnoredTerms(p.text, terms)));
      let healedInSlice = 0;
      for (const [i, phrasing] of vectorless.entries()) {
        const vector = vectors[i];
        if (!vector) continue;
        await deps.setPhrasingVector(scope, phrasing, vector);
        healedInSlice += 1;
      }
      if (healedInSlice === 0) break;
      summary.healed += healedInSlice;
    }
  }
  return summary;
}

export function createCatchupDeps(db: Database, embedder: Embedder): CatchupDeps {
  const { weakScore } = readGapsConfig();
  const { similarity } = readClusterConfig();
  return {
    async listProjects() {
      return db.select({ orgId: projects.orgId, projectId: projects.id }).from(projects);
    },
    ignoredTerms(scope) {
      return readIgnoredTerms(db, scope);
    },
    async loadUnassigned(scope, limit) {
      return db
        .select({ messageId: messages.id, question: gapQuestionSql })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.orgId, scope.orgId),
            eq(conversations.projectId, scope.projectId),
            isGapPredicate(weakScore),
            isNull(messages.gapClusterId),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(limit);
    },
    async embedMany(values) {
      try {
        const vectors = await embedder.embedMany(values);
        return values.map((_, i) => vectors[i] ?? null);
      } catch (error) {
        console.warn("[gaps.catchup] batch embedding failed, assigning by key only:", error);
        return values.map(() => null);
      }
    },
    assign(scope, messageId, embedding) {
      return assignGapCluster(createAssignDeps(db, embedder, scope), {
        messageId,
        threshold: similarity,
        embedding,
      });
    },
    async loadVectorless(scope, limit) {
      return db
        .select({ id: gapPhrasings.id, clusterId: gapPhrasings.clusterId, text: gapPhrasings.text })
        .from(gapPhrasings)
        .where(
          and(
            eq(gapPhrasings.orgId, scope.orgId),
            eq(gapPhrasings.projectId, scope.projectId),
            isNull(gapPhrasings.embedding),
          ),
        )
        .orderBy(asc(gapPhrasings.firstSeen))
        .limit(limit);
    },
    async setPhrasingVector(scope, phrasing, embedding) {
      await db
        .update(gapPhrasings)
        .set({ embedding, embeddingModel: embedder.modelId, updatedAt: new Date() })
        .where(
          and(
            eq(gapPhrasings.orgId, scope.orgId),
            eq(gapPhrasings.projectId, scope.projectId),
            eq(gapPhrasings.id, phrasing.id),
          ),
        );
      // The stale-model notice reads the cluster, not its wordings: a cluster
      // built while the embedder was down has no model until one of its
      // wordings gets a vector.
      await db
        .update(gapClusters)
        .set({ embeddingModel: embedder.modelId, updatedAt: new Date() })
        .where(
          and(
            eq(gapClusters.orgId, scope.orgId),
            eq(gapClusters.projectId, scope.projectId),
            eq(gapClusters.id, phrasing.clusterId),
            isNull(gapClusters.embeddingModel),
          ),
        );
    },
  };
}

export async function handleGapsCatchup(
  db: Database,
  embedder: Embedder,
  job: GapsCatchupJob,
): Promise<CatchupSummary> {
  const summary = await runCatchup(createCatchupDeps(db, embedder), job);
  console.log(
    `[gaps.catchup] projects=${summary.projects} assigned=${summary.assigned} ` +
      `created=${summary.created} healed=${summary.healed}`,
  );
  return summary;
}
