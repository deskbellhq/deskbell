import {
  conversations,
  type Database,
  gapClusters,
  gapQuestionSql,
  isGapPredicate,
  messages,
} from "@deskbell/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";

import type { GapRow } from "./gaps";
import type { GapsConfig } from "./gaps-signal";

/**
 * The one statement behind every docs-gaps read (spec:
 * gaps-period-and-ordering): the page, the Overview count and the exports
 * all run this, so "a gap" means the same thing everywhere.
 *
 * Every refused, marked-down or weakly-evidenced assistant message in the
 * project inside the window, with the question it answered and the cluster
 * it was assigned to (spec: gap-clusters), if any. The question is the
 * closest preceding user turn in the same conversation, as a correlated
 * subquery, so there is no per-row round trip. Grouping happens in code
 * (`lib/gaps`).
 */
export interface GapWindow {
  /** Inclusive start, or null for all time. */
  from: Date | null;
  /** Exclusive end, or null for "up to now". */
  to: Date | null;
}

export async function loadGapRows(
  db: Database,
  project: { id: string; orgId: string },
  window: GapWindow,
  cfg: GapsConfig,
  opts: {
    /**
     * One cluster's rows, for the drawer (spec: gap-drawer-url-state). Still
     * org- and project-scoped through the conversation join, so an id from
     * another tenant matches nothing.
     */
    clusterId?: string;
  } = {},
): Promise<GapRow[]> {
  const rows = await db
    .select({
      messageId: messages.id,
      conversationId: messages.conversationId,
      question: gapQuestionSql,
      refused: messages.refused,
      feedback: messages.feedback,
      feedbackReason: messages.feedbackReason,
      feedbackComment: messages.feedbackComment,
      refusalReason: messages.refusalReason,
      sourcesNamed: messages.sourcesNamed,
      retrievalTopScore: messages.retrievalTopScore,
      unsupportedTerms: messages.unsupportedTerms,
      citations: messages.citations,
      createdAt: messages.createdAt,
      gapClusterId: messages.gapClusterId,
      clusterLabel: gapClusters.label,
      clusterStatus: gapClusters.status,
      clusterResolvedAt: gapClusters.resolvedAt,
      clusterReopenedAt: gapClusters.reopenedAt,
      clusterEmbeddingModel: gapClusters.embeddingModel,
      clusterAnalysis: gapClusters.analysis,
      clusterAnalysisRequestedAt: gapClusters.analysisRequestedAt,
      clusterAnalysisError: gapClusters.analysisError,
      clusterCorrectionDocumentId: gapClusters.correctionDocumentId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .leftJoin(gapClusters, eq(messages.gapClusterId, gapClusters.id))
    .where(
      and(
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        isGapPredicate(cfg.weakScore),
        window.from ? gte(messages.createdAt, window.from) : undefined,
        window.to ? lt(messages.createdAt, window.to) : undefined,
        opts.clusterId ? eq(messages.gapClusterId, opts.clusterId) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt));

  return rows.map(
    ({
      clusterLabel,
      clusterStatus,
      clusterResolvedAt,
      clusterReopenedAt,
      clusterEmbeddingModel,
      clusterAnalysis,
      clusterAnalysisRequestedAt,
      clusterAnalysisError,
      clusterCorrectionDocumentId,
      ...row
    }) => ({
      ...row,
      cluster:
        row.gapClusterId && clusterLabel !== null && clusterStatus !== null
          ? {
              label: clusterLabel,
              status: clusterStatus,
              resolvedAt: clusterResolvedAt,
              reopenedAt: clusterReopenedAt,
              embeddingModel: clusterEmbeddingModel,
              analysis: clusterAnalysis ?? null,
              analysisRequestedAt: clusterAnalysisRequestedAt,
              analysisError: clusterAnalysisError,
              correctionDocumentId: clusterCorrectionDocumentId,
            }
          : null,
    }),
  );
}
