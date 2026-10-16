import { createEmbedder } from "@deskbell/core/models";
import {
  type Database,
  gapClusters,
  gapPhrasings,
  gapQuestionSql,
  messages,
  normalizeQuestion,
  readClusterConfig,
  readIgnoredTerms,
  stripIgnoredTerms,
} from "@deskbell/db";
import type { AssignGapClusterJob } from "@deskbell/shared";
import { newId } from "@deskbell/shared";
import { and, cosineDistance, eq, gte, isNotNull, sql } from "drizzle-orm";

/**
 * gaps.assign (spec: gap-clusters): put one gap message in a cluster.
 *
 * Cheap first: an exact normalised match joins without an embedding call;
 * only a new wording is embedded, with the project's ignored terms removed,
 * and compared with every wording the project has already seen (spec:
 * gap-cluster-members-and-ignored-terms). An embedding failure is not an
 * assignment failure — the message still gets a cluster by wording, its
 * phrasing row vectorless, and the catch-up pass heals it.
 *
 * The algorithm runs over injected dependencies so the paths (join by key,
 * join by similarity, create, reopen) are testable without Postgres or a
 * model; `createAssignDeps` is the Postgres implementation.
 */

export interface ClusterRef {
  id: string;
  status: "open" | "resolved";
  resolvedAt: Date | null;
}

export interface AssignDeps {
  loadMessage(messageId: string): Promise<{
    id: string;
    createdAt: Date;
    gapClusterId: string | null;
    question: string | null;
  } | null>;
  /** The cluster this exact wording already belongs to, if it has been asked before. */
  findByKey(key: string): Promise<(ClusterRef & { phrasingId: string }) | null>;
  /**
   * Nearest *wording* in the same project and embedding model — every one of
   * them, not cluster leaders — with its cluster and the cosine similarity.
   */
  nearestPhrasing(embedding: number[]): Promise<(ClusterRef & { similarity: number }) | null>;
  /** Insert, or return the cluster a racing insert already made for this key. */
  createCluster(input: {
    label: string;
    key: string;
    embedded: boolean;
    at: Date;
  }): Promise<ClusterRef>;
  /** Remember this wording and its vector, so later paraphrases are compared with it. */
  recordPhrasing(input: {
    clusterId: string;
    text: string;
    key: string;
    embedding: number[] | null;
    at: Date;
  }): Promise<void>;
  /** A wording asked again: advance its first/last seen. */
  touchPhrasing(phrasingId: string, at: Date): Promise<void>;
  attach(messageId: string, clusterId: string): Promise<void>;
  /** Advance first/last seen; `reopen` flips a resolved cluster back to open. */
  touch(clusterId: string, at: Date, reopen: boolean): Promise<void>;
  /** Null when the embedder failed — the caller carries on without a vector. */
  embed(text: string): Promise<number[] | null>;
  /**
   * The automatic analysis rule (spec: gap-analysis), when enabled: request
   * an analysis once a cluster without one reaches the threshold of recent
   * occurrences. Absent when DESKBELL_GAPS_AUTO_ANALYZE_AT is 0.
   */
  autoAnalyze?: {
    threshold: number;
    recentOccurrences(clusterId: string, since: Date): Promise<number>;
    /** Whether an analysis exists or one is already pending. */
    analysisState(clusterId: string): Promise<{ hasAnalysis: boolean; pending: boolean }>;
    request(clusterId: string): Promise<void>;
  };
}

export type JoinedBy = "existing" | "key" | "embedding" | "created";

export interface AssignResult {
  clusterId: string;
  joinedBy: JoinedBy;
  reopened: boolean;
  /** An analysis was requested by the automatic rule on this occurrence. */
  analysisRequested: boolean;
}

/** The window the automatic rule counts occurrences in. */
export const AUTO_ANALYZE_WINDOW_DAYS = 30;

/** Text a message without a user turn is grouped under, so the row is never lost. */
export const NO_QUESTION = "(no user message)";

export async function assignGapCluster(
  deps: AssignDeps,
  input: {
    messageId: string;
    threshold: number;
    /** Removed from the question before it is embedded, and nowhere else. */
    ignoredTerms?: readonly string[];
    /** A vector already computed for this question (the catch-up embeds in batches); undefined = ask `deps.embed`. */
    embedding?: number[] | null;
  },
): Promise<AssignResult | null> {
  const message = await deps.loadMessage(input.messageId);
  if (!message) return null;
  if (message.gapClusterId) {
    return {
      clusterId: message.gapClusterId,
      joinedBy: "existing",
      reopened: false,
      analysisRequested: false,
    };
  }

  const question = message.question?.trim() || NO_QUESTION;
  const key = normalizeQuestion(question);

  const known = await deps.findByKey(key);
  let cluster: ClusterRef | null = known;
  let joinedBy: JoinedBy = "key";
  let embedding: number[] | null = null;
  if (!cluster) {
    embedding =
      input.embedding === undefined
        ? await deps.embed(stripIgnoredTerms(question, input.ignoredTerms ?? []))
        : input.embedding;
    if (embedding) {
      const nearest = await deps.nearestPhrasing(embedding);
      if (nearest && nearest.similarity >= input.threshold) {
        cluster = nearest;
        joinedBy = "embedding";
      }
    }
  }
  if (!cluster) {
    cluster = await deps.createCluster({
      label: question,
      key,
      embedded: embedding !== null,
      at: message.createdAt,
    });
    joinedBy = "created";
  }

  // A wording is remembered once and compared with forever after: the vector
  // this assignment computed is what the next paraphrase is measured against.
  if (known) {
    await deps.touchPhrasing(known.phrasingId, message.createdAt);
  } else {
    await deps.recordPhrasing({
      clusterId: cluster.id,
      text: question,
      key,
      embedding,
      at: message.createdAt,
    });
  }

  // An occurrence AFTER the cluster was resolved means the fix did not hold
  // (or was never made): open it again. An older occurrence being assigned
  // late — a catch-up over history — says nothing about the fix.
  const reopen =
    cluster.status === "resolved" &&
    cluster.resolvedAt !== null &&
    message.createdAt.getTime() > cluster.resolvedAt.getTime();

  await deps.attach(message.id, cluster.id);
  await deps.touch(cluster.id, message.createdAt, reopen);

  // Once, at the threshold, only for a cluster nobody has analysed: a
  // cluster with an analysis is the operator's to refresh, and a pending
  // request is not doubled.
  let analysisRequested = false;
  const auto = deps.autoAnalyze;
  if (auto && auto.threshold > 0) {
    const since = new Date(Date.now() - AUTO_ANALYZE_WINDOW_DAYS * 86_400_000);
    const recent = await auto.recentOccurrences(cluster.id, since);
    if (recent >= auto.threshold) {
      const state = await auto.analysisState(cluster.id);
      if (!state.hasAnalysis && !state.pending) {
        await auto.request(cluster.id);
        analysisRequested = true;
      }
    }
  }
  return { clusterId: cluster.id, joinedBy, reopened: reopen, analysisRequested };
}

export interface ClusterScope {
  orgId: string;
  projectId: string;
}

/** What `embed` needs: the batch embedder the worker already builds. */
export interface Embedder {
  modelId: string;
  embedMany(values: string[]): Promise<number[][]>;
}

export function createAssignDeps(
  db: Database,
  embedder: Embedder,
  scope: ClusterScope,
  autoAnalyze?: { threshold: number; request(clusterId: string): Promise<void> },
): AssignDeps {
  const inProject = and(
    eq(gapClusters.orgId, scope.orgId),
    eq(gapClusters.projectId, scope.projectId),
  );
  const inProjectPhrasings = and(
    eq(gapPhrasings.orgId, scope.orgId),
    eq(gapPhrasings.projectId, scope.projectId),
  );
  const ref = {
    id: gapClusters.id,
    status: gapClusters.status,
    resolvedAt: gapClusters.resolvedAt,
  };
  return {
    async loadMessage(messageId) {
      const [row] = await db
        .select({
          id: messages.id,
          createdAt: messages.createdAt,
          gapClusterId: messages.gapClusterId,
          question: gapQuestionSql,
        })
        .from(messages)
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.orgId, scope.orgId),
            eq(messages.role, "assistant"),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findByKey(key) {
      const [row] = await db
        .select({ ...ref, phrasingId: gapPhrasings.id })
        .from(gapPhrasings)
        .innerJoin(gapClusters, eq(gapPhrasings.clusterId, gapClusters.id))
        .where(and(inProjectPhrasings, eq(gapPhrasings.normalizedKey, key)))
        .limit(1);
      return row ?? null;
    },
    async nearestPhrasing(embedding) {
      // Exact, no approximate index: a project's distinct wordings number in
      // the low thousands, and an ANN scan under a tenant filter is the
      // problem the retrieval defaults had to work around. Wordings embedded
      // with another model are not comparable and are skipped, not scored.
      const distance = cosineDistance(gapPhrasings.embedding, embedding);
      const [row] = await db
        .select({ ...ref, similarity: sql<number>`1 - (${distance})` })
        .from(gapPhrasings)
        .innerJoin(gapClusters, eq(gapPhrasings.clusterId, gapClusters.id))
        .where(
          and(
            inProjectPhrasings,
            isNotNull(gapPhrasings.embedding),
            eq(gapPhrasings.embeddingModel, embedder.modelId),
          ),
        )
        .orderBy(distance)
        .limit(1);
      return row ?? null;
    },
    async createCluster({ label, key, embedded, at }) {
      const [inserted] = await db
        .insert(gapClusters)
        .values({
          id: newId("gap"),
          orgId: scope.orgId,
          projectId: scope.projectId,
          label,
          normalizedKey: key,
          embeddingModel: embedded ? embedder.modelId : null,
          firstSeen: at,
          lastSeen: at,
        })
        .onConflictDoNothing({ target: [gapClusters.projectId, gapClusters.normalizedKey] })
        .returning(ref);
      if (inserted) return inserted;
      // Lost the race to another worker on the same key: theirs is the cluster.
      const [existing] = await db
        .select(ref)
        .from(gapClusters)
        .where(and(inProject, eq(gapClusters.normalizedKey, key)))
        .limit(1);
      if (!existing) throw new Error(`gap cluster for key "${key}" vanished after conflict`);
      return existing;
    },
    async recordPhrasing({ clusterId, text, key, embedding, at }) {
      await db
        .insert(gapPhrasings)
        .values({
          id: newId("gph"),
          orgId: scope.orgId,
          projectId: scope.projectId,
          clusterId,
          text,
          normalizedKey: key,
          embedding,
          embeddingModel: embedding ? embedder.modelId : null,
          firstSeen: at,
          lastSeen: at,
        })
        // A racing worker may have written this wording already; its cluster
        // stands (cluster_id is deliberately not in the update), and all this
        // one contributes is the occurrence and, if it has one, the vector.
        .onConflictDoUpdate({
          target: [gapPhrasings.projectId, gapPhrasings.normalizedKey],
          set: {
            firstSeen: sql`least(${gapPhrasings.firstSeen}, excluded.first_seen)`,
            lastSeen: sql`greatest(${gapPhrasings.lastSeen}, excluded.last_seen)`,
            embedding: sql`coalesce(excluded.embedding, ${gapPhrasings.embedding})`,
            embeddingModel: sql`coalesce(excluded.embedding_model, ${gapPhrasings.embeddingModel})`,
            updatedAt: new Date(),
          },
        });
    },
    async touchPhrasing(phrasingId, at) {
      await db
        .update(gapPhrasings)
        .set({
          firstSeen: sql`least(${gapPhrasings.firstSeen}, ${at})`,
          lastSeen: sql`greatest(${gapPhrasings.lastSeen}, ${at})`,
          updatedAt: new Date(),
        })
        .where(and(inProjectPhrasings, eq(gapPhrasings.id, phrasingId)));
    },
    async attach(messageId, clusterId) {
      await db
        .update(messages)
        .set({ gapClusterId: clusterId })
        .where(and(eq(messages.id, messageId), eq(messages.orgId, scope.orgId)));
    },
    async touch(clusterId, at, reopen) {
      await db
        .update(gapClusters)
        .set({
          firstSeen: sql`least(${gapClusters.firstSeen}, ${at})`,
          lastSeen: sql`greatest(${gapClusters.lastSeen}, ${at})`,
          ...(reopen ? { status: "open" as const, reopenedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(and(inProject, eq(gapClusters.id, clusterId)));
    },
    async embed(text) {
      try {
        const [vector] = await embedder.embedMany([text]);
        return vector ?? null;
      } catch (error) {
        console.warn("[gaps.assign] embedding failed, assigning by key only:", error);
        return null;
      }
    },
    autoAnalyze: autoAnalyze
      ? {
          threshold: autoAnalyze.threshold,
          async recentOccurrences(clusterId, since) {
            const [row] = await db
              .select({ n: sql<number>`count(*)`.mapWith(Number) })
              .from(messages)
              .where(
                and(
                  eq(messages.orgId, scope.orgId),
                  eq(messages.gapClusterId, clusterId),
                  gte(messages.createdAt, since),
                ),
              );
            return row?.n ?? 0;
          },
          async analysisState(clusterId) {
            const [row] = await db
              .select({
                analysis: gapClusters.analysis,
                requestedAt: gapClusters.analysisRequestedAt,
              })
              .from(gapClusters)
              .where(and(inProject, eq(gapClusters.id, clusterId)))
              .limit(1);
            return { hasAnalysis: row?.analysis != null, pending: row?.requestedAt != null };
          },
          async request(clusterId) {
            await db
              .update(gapClusters)
              .set({ analysisRequestedAt: new Date(), analysisRequestedBy: null })
              .where(and(inProject, eq(gapClusters.id, clusterId)));
            await autoAnalyze.request(clusterId);
          },
        }
      : undefined,
  };
}

export async function handleAssignGapCluster(
  db: Database,
  embedder: Embedder,
  job: AssignGapClusterJob,
  enqueueAnalysis?: (clusterId: string) => Promise<void>,
): Promise<void> {
  const { similarity, autoAnalyzeAt } = readClusterConfig();
  const scope = { orgId: job.orgId, projectId: job.projectId };
  const ignoredTerms = await readIgnoredTerms(db, scope);
  const deps = createAssignDeps(
    db,
    embedder,
    scope,
    enqueueAnalysis && autoAnalyzeAt > 0
      ? { threshold: autoAnalyzeAt, request: enqueueAnalysis }
      : undefined,
  );
  const result = await assignGapCluster(deps, {
    messageId: job.messageId,
    threshold: similarity,
    ignoredTerms,
  });
  if (!result) {
    console.warn(`[gaps.assign] message ${job.messageId} not found in org ${job.orgId}`);
    return;
  }
  console.log(
    `[gaps.assign] message=${job.messageId} cluster=${result.clusterId} via=${result.joinedBy}` +
      (result.reopened ? " reopened" : "") +
      (result.analysisRequested ? " analysis-requested" : ""),
  );
}

/** The worker's embedder, typed to what this handler needs. */
export function workerEmbedder(): Embedder {
  return createEmbedder();
}
