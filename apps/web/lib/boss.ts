import {
  type AnalyzeGapClusterJob,
  type AssignGapClusterJob,
  type ClassifyQuestionJob,
  type DeliverNotificationJob,
  type GapsCatchupJob,
  type IngestDocumentJob,
  type IngestSourceJob,
  type PurgeConversationsJob,
  QUEUE_ANALYZE_GAP_CLUSTER,
  QUEUE_ASSIGN_GAP_CLUSTER,
  QUEUE_CLASSIFY_QUESTION,
  QUEUE_GAPS_CATCHUP,
  QUEUE_INGEST_DOCUMENT,
  QUEUE_INGEST_SOURCE,
  QUEUE_NOTIFICATIONS_DELIVER,
  QUEUE_PURGE_CONVERSATIONS,
  QUEUE_REINDEX_EMBEDDINGS,
  QUEUE_TITLE_CONVERSATION,
  QUEUE_TOPICS_CATCHUP,
  type ReindexEmbeddingsJob,
  type TitleConversationJob,
  type TopicsCatchupJob,
} from "@deskbell/shared";
import { PgBoss } from "pg-boss";

// Producer-only pg-boss instance (no supervision/scheduling — the worker owns
// those). Cached on globalThis to survive Next dev HMR. start() installs the
// pgboss schema and createQueue is idempotent, so enqueueing works even if the
// worker has never run yet.
const globalForBoss = globalThis as unknown as { deskbellBoss?: Promise<PgBoss> };

async function createBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const boss = new PgBoss({ connectionString, supervise: false, schedule: false });
  boss.on("error", (err) => console.error("[pg-boss:web]", err));
  await boss.start();
  await boss.createQueue(QUEUE_INGEST_SOURCE);
  await boss.createQueue(QUEUE_INGEST_DOCUMENT);
  await boss.createQueue(QUEUE_REINDEX_EMBEDDINGS);
  await boss.createQueue(QUEUE_ASSIGN_GAP_CLUSTER);
  await boss.createQueue(QUEUE_GAPS_CATCHUP);
  await boss.createQueue(QUEUE_ANALYZE_GAP_CLUSTER);
  await boss.createQueue(QUEUE_TITLE_CONVERSATION);
  await boss.createQueue(QUEUE_NOTIFICATIONS_DELIVER);
  await boss.createQueue(QUEUE_PURGE_CONVERSATIONS);
  await boss.createQueue(QUEUE_CLASSIFY_QUESTION);
  await boss.createQueue(QUEUE_TOPICS_CATCHUP);
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  globalForBoss.deskbellBoss ??= createBoss();
  return globalForBoss.deskbellBoss;
}

export async function enqueueIngestSource(job: IngestSourceJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_INGEST_SOURCE, job);
}

export async function enqueueIngestDocument(job: IngestDocumentJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_INGEST_DOCUMENT, job);
}

export async function enqueueReindexEmbeddings(job: ReindexEmbeddingsJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_REINDEX_EMBEDDINGS, job);
}

export async function enqueueAssignGapCluster(job: AssignGapClusterJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_ASSIGN_GAP_CLUSTER, job);
}

export async function enqueueGapsCatchup(job: GapsCatchupJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_GAPS_CATCHUP, job);
}

export async function enqueueAnalyzeGapCluster(job: AnalyzeGapClusterJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_ANALYZE_GAP_CLUSTER, job);
}

export async function enqueueTitleConversation(job: TitleConversationJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_TITLE_CONVERSATION, job);
}

/**
 * The first queue to pass pg-boss options (spec: project-notifications).
 * The singleton key collapses a down→up→down toggle while a job is still
 * queued; a retry after the third failure would be a fourth request to a
 * receiver that has answered 5xx three times over a couple of minutes, so
 * it stops there; and one attempt is bounded so a hung receiver cannot hold
 * the worker beyond the delivery timeout plus a margin.
 */
export async function enqueueNotification(job: DeliverNotificationJob): Promise<void> {
  const boss = await getBoss();
  const subjectKey = Object.values(job.subject)[0] ?? "";
  await boss.send(QUEUE_NOTIFICATIONS_DELIVER, job, {
    singletonKey: `${job.event}:${subjectKey}`,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: 30,
    expireInSeconds: 60,
  });
}

/**
 * Run the retention purge for one project now rather than at the next hourly
 * tick (spec: conversation-retention). The singleton key collapses repeated
 * saves while a run is still queued; the hourly job is the safety net, so a
 * lost request costs at most an hour.
 */
export async function enqueuePurgeConversations(job: PurgeConversationsJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_PURGE_CONVERSATIONS, job, { singletonKey: `purge:${job.projectId}` });
}

/** Label one visitor question with its topic, intent and signals (spec: question-topics, intent-and-signals). */
export async function enqueueClassifyQuestion(job: ClassifyQuestionJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_CLASSIFY_QUESTION, job);
}

/**
 * Label a project's unlabelled questions now rather than at the next hourly
 * tick (spec: question-topics), after the settings page cleared them. The
 * singleton key collapses repeated saves while a run is still queued.
 */
export async function enqueueTopicsCatchup(job: TopicsCatchupJob): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE_TOPICS_CATCHUP, job, { singletonKey: `topics:${job.projectId ?? "all"}` });
}
