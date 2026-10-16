import type { GapAnalysisInput, GapAnalyst } from "@deskbell/core/models";
import {
  type Database,
  gapClusters,
  gapQuestionSql,
  messages,
  projects,
  recordUsage,
  type StoredGapAnalysis,
  tokensUsedToday,
} from "@deskbell/db";
import { type AnalyzeGapClusterJob, GAP_ANALYSIS_BUDGET_ERROR } from "@deskbell/shared";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * gaps.analyze (spec: gap-analysis): one cluster → a finding, a
 * recommendation and suggested marking criteria, written by the configured
 * chat model and stored on the cluster.
 *
 * Skips when the material is unchanged (same phrasings, evidence and model
 * as the stored analysis), refuses when the project's daily budget is
 * spent, records usage on success and the error on failure. Injected deps
 * so every branch is testable without Postgres or a model.
 */

export interface AnalyzeDeps {
  loadCluster(clusterId: string): Promise<{
    id: string;
    label: string;
    analysis: StoredGapAnalysis | null;
  } | null>;
  /** Distinct phrasings, most common first. */
  loadQuestions(clusterId: string, limit: number): Promise<string[]>;
  /** Evidence documents across the cluster's messages, most common first. */
  loadEvidence(
    clusterId: string,
    limit: number,
  ): Promise<Array<{ title: string; url?: string; snippet: string }>>;
  loadSignals(clusterId: string): Promise<{
    refused: boolean;
    downvoted: boolean;
    weak: boolean;
    /** Any answer named something the documentation lacks (spec: answer-verification). */
    unsupported: boolean;
    /** Those names, most used first. */
    unsupportedTerms: string[];
  }>;
  budget(): Promise<{ limit: number; usedToday: number }>;
  analyst: Pick<GapAnalyst, "modelId" | "inputHash" | "analyze">;
  save(clusterId: string, analysis: StoredGapAnalysis): Promise<void>;
  saveError(clusterId: string, error: string): Promise<void>;
  /** Clears the pending mark without touching the stored analysis. */
  clearPending(clusterId: string): Promise<void>;
  recordUsage(usage: { input: number; output: number }): Promise<void>;
}

export type AnalyzeOutcome = "analyzed" | "unchanged" | "budget" | "missing";

export const BUDGET_ERROR = GAP_ANALYSIS_BUDGET_ERROR;

export async function analyzeGapCluster(
  deps: AnalyzeDeps,
  clusterId: string,
  now: Date = new Date(),
): Promise<AnalyzeOutcome> {
  const cluster = await deps.loadCluster(clusterId);
  if (!cluster) return "missing";

  const [questions, evidence, signals] = await Promise.all([
    deps.loadQuestions(clusterId, 12),
    deps.loadEvidence(clusterId, 6),
    deps.loadSignals(clusterId),
  ]);
  // The verification signal and its names enter the input only when set, so
  // the stored hash of a cluster analysed before they existed still matches.
  const { unsupported, unsupportedTerms, ...flags } = signals;
  const input: GapAnalysisInput = {
    label: cluster.label,
    questions,
    signals: unsupported ? { ...flags, unsupported: true } : flags,
    evidence,
    ...(unsupportedTerms.length > 0 ? { unsupportedTerms } : {}),
  };
  const inputHash = deps.analyst.inputHash(input);

  // Same material, same model: nothing to learn, nothing to spend.
  if (cluster.analysis?.inputHash === inputHash) {
    await deps.clearPending(clusterId);
    return "unchanged";
  }

  const { limit, usedToday } = await deps.budget();
  if (limit > 0 && usedToday >= limit) {
    await deps.saveError(clusterId, BUDGET_ERROR);
    return "budget";
  }

  let usage = { input: 0, output: 0 };
  try {
    const result = await deps.analyst.analyze(input, {
      onUsage: (u) => {
        usage = u;
      },
    });
    await deps.save(clusterId, {
      ...result,
      model: deps.analyst.modelId,
      analyzedAt: now.toISOString(),
      inputHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.saveError(clusterId, message.slice(0, 500));
    throw error;
  } finally {
    // Charged even when the call failed after the provider counted tokens.
    if (usage.input + usage.output > 0) await deps.recordUsage(usage);
  }
  return "analyzed";
}

export function createAnalyzeDeps(
  db: Database,
  analyst: GapAnalyst,
  scope: { orgId: string; projectId: string },
): AnalyzeDeps {
  const inProject = and(
    eq(gapClusters.orgId, scope.orgId),
    eq(gapClusters.projectId, scope.projectId),
  );
  return {
    async loadCluster(clusterId) {
      const [row] = await db
        .select({ id: gapClusters.id, label: gapClusters.label, analysis: gapClusters.analysis })
        .from(gapClusters)
        .where(and(inProject, eq(gapClusters.id, clusterId)))
        .limit(1);
      return row ? { ...row, analysis: row.analysis ?? null } : null;
    },
    async loadQuestions(clusterId, limit) {
      const rows = await db
        .select({ question: gapQuestionSql, n: sql<number>`count(*)`.mapWith(Number) })
        .from(messages)
        .where(and(eq(messages.orgId, scope.orgId), eq(messages.gapClusterId, clusterId)))
        .groupBy(sql`1`)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);
      return rows.map((r) => r.question).filter((q): q is string => typeof q === "string");
    },
    async loadEvidence(clusterId, limit) {
      // Citations are the evidence column (spec: docs-gaps-page): what was
      // found on a refusal, what was cited on an answer. Ranked by how many
      // of the cluster's messages carried each document.
      const rows = await db
        .select({ citations: messages.citations })
        .from(messages)
        .where(and(eq(messages.orgId, scope.orgId), eq(messages.gapClusterId, clusterId)));
      const tally = new Map<
        string,
        { title: string; url?: string; snippet: string; count: number }
      >();
      for (const row of rows) {
        const seen = new Set<string>();
        for (const c of row.citations ?? []) {
          if (!c || typeof c !== "object") continue;
          const { documentId, title, url, snippet } = c as Record<string, unknown>;
          if (typeof documentId !== "string" || typeof title !== "string" || seen.has(documentId))
            continue;
          seen.add(documentId);
          const entry = tally.get(documentId) ?? {
            title,
            ...(typeof url === "string" ? { url } : {}),
            snippet: typeof snippet === "string" ? snippet : "",
            count: 0,
          };
          entry.count += 1;
          tally.set(documentId, entry);
        }
      }
      return [...tally.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(({ count: _count, ...e }) => e);
    },
    async loadSignals(clusterId) {
      const [row] = await db
        .select({
          refused: sql<number>`count(*) filter (where ${messages.refused})`.mapWith(Number),
          downvoted: sql<number>`count(*) filter (where ${messages.feedback} = 'down')`.mapWith(
            Number,
          ),
          weak: sql<number>`count(*) filter (where not ${messages.refused} and ${messages.retrievalTopScore} is not null)`.mapWith(
            Number,
          ),
        })
        .from(messages)
        .where(and(eq(messages.orgId, scope.orgId), eq(messages.gapClusterId, clusterId)));
      // The names the cluster's answers could not support, most used first
      // (spec: answer-verification). Org-scoped like every read (D12).
      const terms = (
        await db.execute(sql`
          SELECT t.term AS term, count(*) AS n
          FROM ${messages} m, unnest(m.unsupported_terms) AS t(term)
          WHERE m.org_id = ${scope.orgId} AND m.gap_cluster_id = ${clusterId}
          GROUP BY t.term
          ORDER BY count(*) DESC, t.term
          LIMIT 8`)
      ).rows as unknown as Array<{ term: string }>;
      return {
        refused: (row?.refused ?? 0) > 0,
        downvoted: (row?.downvoted ?? 0) > 0,
        weak: (row?.weak ?? 0) > 0,
        unsupported: terms.length > 0,
        unsupportedTerms: terms.map((t) => t.term),
      };
    },
    async budget() {
      const [project] = await db
        .select({ limit: projects.dailyTokenBudget })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
        .limit(1);
      const usedToday = await tokensUsedToday(db, scope.projectId, scope.orgId);
      return { limit: project?.limit ?? 0, usedToday };
    },
    analyst,
    async save(clusterId, analysis) {
      await db
        .update(gapClusters)
        .set({
          analysis,
          analysisError: null,
          analysisRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(and(inProject, eq(gapClusters.id, clusterId)));
    },
    async saveError(clusterId, error) {
      await db
        .update(gapClusters)
        .set({ analysisError: error, analysisRequestedAt: null, updatedAt: new Date() })
        .where(and(inProject, eq(gapClusters.id, clusterId)));
    },
    async clearPending(clusterId) {
      await db
        .update(gapClusters)
        .set({ analysisRequestedAt: null, updatedAt: new Date() })
        .where(and(inProject, eq(gapClusters.id, clusterId)));
    },
    recordUsage(usage) {
      return recordUsage(db, {
        orgId: scope.orgId,
        projectId: scope.projectId,
        usage: { ...usage, embedding: 0 },
      });
    },
  };
}

export async function handleAnalyzeGapCluster(
  db: Database,
  analyst: GapAnalyst,
  job: AnalyzeGapClusterJob,
): Promise<AnalyzeOutcome> {
  const outcome = await analyzeGapCluster(
    createAnalyzeDeps(db, analyst, { orgId: job.orgId, projectId: job.projectId }),
    job.clusterId,
  );
  console.log(
    `[gaps.analyze] cluster=${job.clusterId} outcome=${outcome}` +
      (job.requestedBy ? ` by=${job.requestedBy}` : " by=auto"),
  );
  return outcome;
}
