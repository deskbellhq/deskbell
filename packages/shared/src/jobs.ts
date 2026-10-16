import { z } from "zod";

/**
 * pg-boss queue contracts between the web producer and the worker.
 * Server-internal: these never ship to browsers (the widget imports wire
 * types from ./index type-only and is bundled without zod).
 */

export const QUEUE_INGEST_SOURCE = "ingest.source";
export const QUEUE_EMBED_CHUNKS = "embed.chunks";
export const QUEUE_REINDEX_EMBEDDINGS = "reindex.embeddings";
/** Scheduled housekeeping; carries no payload (spec: widget-abuse-protection). */
export const QUEUE_MAINTENANCE_PRUNE = "maintenance.prune";

export const IngestSourceJobSchema = z.object({
  orgId: z.string().min(1),
  sourceId: z.string().min(1),
});
export type IngestSourceJob = z.infer<typeof IngestSourceJobSchema>;

// Re-exported so server code keeps one import; the widget reads it from
// ./source-types, which carries no zod.
export { CORRECTIONS_SOURCE_TYPE } from "./source-types";

export const EmbedChunksJobSchema = z.object({
  orgId: z.string().min(1),
  sourceId: z.string().min(1),
  documentId: z.string().min(1),
});
export type EmbedChunksJob = z.infer<typeof EmbedChunksJobSchema>;

/**
 * Re-chunk one stored document and enqueue its embedding (spec:
 * corrections-source). The document is already in the database — the
 * dashboard wrote it — so this is the ingest path for content that no
 * connector discovers. Retries are safe: chunks are replaced, not appended.
 */
export const QUEUE_INGEST_DOCUMENT = "ingest.document";
export const IngestDocumentJobSchema = z.object({
  orgId: z.string().min(1),
  sourceId: z.string().min(1),
  documentId: z.string().min(1),
});
export type IngestDocumentJob = z.infer<typeof IngestDocumentJobSchema>;

/**
 * Re-embed chunks whose embedding_version is behind targetVersion (spec:
 * ingestion-pipeline). Omitting projectId re-indexes the whole org; either
 * way every query is org-scoped (D12). The version-behind-target predicate
 * is what makes the job resumable: a crash mid-run leaves completed rows
 * advanced, and a retry continues instead of restarting.
 */
export const ReindexEmbeddingsJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  targetModel: z.string().min(1),
  targetVersion: z.number().int().positive(),
});
export type ReindexEmbeddingsJob = z.infer<typeof ReindexEmbeddingsJobSchema>;

/**
 * Assign one gap message to a cluster (spec: gap-clusters). Enqueued by the
 * ask route after a gap row is written and by the feedback route on a
 * thumbs-down; the hourly catch-up is the safety net for any it misses.
 */
export const QUEUE_ASSIGN_GAP_CLUSTER = "gaps.assign";
export const AssignGapClusterJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  messageId: z.string().min(1),
});
export type AssignGapClusterJob = z.infer<typeof AssignGapClusterJobSchema>;

/**
 * Assign every gap-qualifying message without a cluster, oldest first, and
 * give leaderless clusters their vector (spec: gap-clusters). Scheduled
 * hourly with no payload; a re-cluster sends it for one project.
 */
export const QUEUE_GAPS_CATCHUP = "gaps.catchup";
export const GapsCatchupJobSchema = z.object({
  orgId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
export type GapsCatchupJob = z.infer<typeof GapsCatchupJobSchema>;

/**
 * Remove conversations past a project's retention window (spec:
 * conversation-retention). Scheduled hourly with no payload; the settings page
 * sends it for one project when a window is saved so the first removal does
 * not wait for the cron. Batched and capped per run, so a large backlog is
 * removed over several runs.
 */
export const QUEUE_PURGE_CONVERSATIONS = "purge.conversations";
export const PurgeConversationsJobSchema = z.object({
  orgId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
export type PurgeConversationsJob = z.infer<typeof PurgeConversationsJobSchema>;

/**
 * Analyse one gap cluster with the configured chat model (spec:
 * gap-analysis). Enqueued by an editor's click, or by the assignment job
 * when the auto-analyse threshold is reached. Budget-checked in the worker.
 */
export const QUEUE_ANALYZE_GAP_CLUSTER = "gaps.analyze";
export const AnalyzeGapClusterJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  clusterId: z.string().min(1),
  /** Who asked, for the audit trail; absent for the automatic rule. */
  requestedBy: z.string().min(1).optional(),
});
export type AnalyzeGapClusterJob = z.infer<typeof AnalyzeGapClusterJobSchema>;

/**
 * What the worker stores on a cluster when the project's daily token budget
 * is spent before its analysis could run. Shared so the dashboard can tell a
 * budget refusal from a model failure without re-typing the string.
 */
export const GAP_ANALYSIS_BUDGET_ERROR = "daily token budget reached — analysis skipped";

/**
 * Write a short title for one conversation with the chat model (spec:
 * conversation-context-and-titles). Enqueued by the ask route when a
 * conversation is created and DESKBELL_THREAD_TITLES=model; by default the
 * first question is the title and no job runs.
 */
export const QUEUE_TITLE_CONVERSATION = "conversations.title";
export const TitleConversationJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
});
export type TitleConversationJob = z.infer<typeof TitleConversationJobSchema>;

/**
 * Deliver one notification event to every channel a project has it switched
 * on for (spec: project-notifications). The payload is a subject reference,
 * not the rendered event: the worker reads current state, so a vote
 * withdrawn before the job ran produces nothing. `baseUrl` is resolved by
 * the producer from the environment, never from request headers.
 */
export const QUEUE_NOTIFICATIONS_DELIVER = "notifications.deliver";
export const DeliverNotificationJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  event: z.enum(["feedback.negative"]),
  subject: z.record(z.string(), z.string().min(1)),
  baseUrl: z.string().url(),
});
export type DeliverNotificationJob = z.infer<typeof DeliverNotificationJobSchema>;
