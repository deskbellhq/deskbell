import { createVectorStore } from "@deskbell/core";
import {
  createConversationTitlerDeps,
  createEmbedder,
  createFeedbackSummarizerDeps,
  createGapAnalystDeps,
  createQuestionClassifierDeps,
  notificationSummaryMode,
} from "@deskbell/core/models";
import { chunks, type Database, expirePendingActions, pruneRateLimits } from "@deskbell/db";
import {
  AnalyzeGapClusterJobSchema,
  AssignGapClusterJobSchema,
  ClassifyQuestionJobSchema,
  DeliverNotificationJobSchema,
  EmbedChunksJobSchema,
  GapsCatchupJobSchema,
  IngestDocumentJobSchema,
  IngestSourceJobSchema,
  PurgeConversationsJobSchema,
  QUEUE_ANALYZE_GAP_CLUSTER,
  QUEUE_ASSIGN_GAP_CLUSTER,
  QUEUE_CLASSIFY_QUESTION,
  QUEUE_EMBED_CHUNKS,
  QUEUE_GAPS_CATCHUP,
  QUEUE_INGEST_DOCUMENT,
  QUEUE_INGEST_SOURCE,
  QUEUE_MAINTENANCE_PRUNE,
  QUEUE_NOTIFICATIONS_DELIVER,
  QUEUE_PURGE_CONVERSATIONS,
  QUEUE_REINDEX_EMBEDDINGS,
  QUEUE_TITLE_CONVERSATION,
  QUEUE_TOPICS_CATCHUP,
  ReindexEmbeddingsJobSchema,
  TitleConversationJobSchema,
  TopicsCatchupJobSchema,
} from "@deskbell/shared";
import { and, count, isNotNull, ne } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { getDb } from "./db";
import { handleAnalyzeGapCluster } from "./handlers/analyze-gap-cluster";
import { handleAssignGapCluster } from "./handlers/assign-gap-cluster";
import { handleClassifyQuestion } from "./handlers/classify-question";
import { handleDeliverNotification } from "./handlers/deliver-notification";
import { handleEmbedChunks } from "./handlers/embed-chunks";
import { handleGapsCatchup } from "./handlers/gaps-catchup";
import { handleIngestDocument } from "./handlers/ingest-document";
import { handleIngestSource } from "./handlers/ingest-source";
import { handlePurgeConversations } from "./handlers/purge-conversations";
import { handleReindexEmbeddings } from "./handlers/reindex-embeddings";
import { handleTitleConversation } from "./handlers/title-conversation";
import { handleTopicsCatchup } from "./handlers/topics-catchup";

/**
 * Background jobs on pg-boss — Postgres is the ONLY infra dependency (D11).
 * Queues:
 *   ingest.source       — run a connector, upsert documents (content-hash dedupe)
 *   ingest.document     — re-chunk one document the dashboard wrote (spec: corrections-source)
 *   embed.chunks        — embed new/changed documents' chunks
 *   reindex.embeddings  — re-embed everything after an embedding-model change (D12)
 *   purge.conversations — remove conversations past a project's retention window, hourly (spec: conversation-retention)
 *   maintenance.prune   — drop elapsed rate-limit windows, hourly
 *   gaps.assign         — put one gap message in a cluster (spec: gap-clusters)
 *   gaps.catchup        — assign what the producers missed, heal leaderless clusters, hourly
 *   gaps.analyze        — a finding and a recommendation for one cluster (spec: gap-analysis)
 *   conversations.title — name a thread from its first exchange, opt-in (spec: conversation-context-and-titles)
 *   notifications.deliver — post one event to the project's Slack/webhook channels (spec: project-notifications)
 *   topics.classify     — label one visitor question with a project topic (spec: question-topics)
 *   topics.catchup      — label what the producers missed, hourly, and after a topic-list change
 */
/**
 * Chunks whose vector is in a store other than the configured one cannot
 * be retrieved until a re-index moves them (spec: vector-store-single-home).
 * The Sources page says so per project; this says so once, at boot, for the
 * operator reading the worker's log after changing DESKBELL_VECTOR_STORE.
 */
async function warnOnChunksElsewhere(db: Database, storeId: string) {
  const rows = await db
    .select({ store: chunks.vectorStore, n: count() })
    .from(chunks)
    .where(and(isNotNull(chunks.vectorStore), ne(chunks.vectorStore, storeId)))
    .groupBy(chunks.vectorStore);
  for (const row of rows) {
    console.warn(
      `[vector-store] ${row.n} chunks are indexed in ${row.store} but the configured store is ` +
        `${storeId} — they cannot be retrieved until a re-index moves them (Sources › Re-embed)`,
    );
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const db = getDb();
  const vectorStore = createVectorStore(db);
  await warnOnChunksElsewhere(db, vectorStore.id);
  const embedder = createEmbedder();
  // Built here, used only by gaps.analyze: its model is built on first use,
  // so a bad analyst id fails one analysis rather than this boot.
  const analyst = createGapAnalystDeps();
  const titler = createConversationTitlerDeps();
  const classifier = createQuestionClassifierDeps();
  // Null turns the summary sentence off; the notification itself still goes out.
  const summarizer = notificationSummaryMode() === "model" ? createFeedbackSummarizerDeps() : null;

  const boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  for (const queue of [
    QUEUE_INGEST_SOURCE,
    QUEUE_INGEST_DOCUMENT,
    QUEUE_EMBED_CHUNKS,
    QUEUE_REINDEX_EMBEDDINGS,
    QUEUE_MAINTENANCE_PRUNE,
    QUEUE_ASSIGN_GAP_CLUSTER,
    QUEUE_GAPS_CATCHUP,
    QUEUE_ANALYZE_GAP_CLUSTER,
    QUEUE_TITLE_CONVERSATION,
    QUEUE_NOTIFICATIONS_DELIVER,
    QUEUE_PURGE_CONVERSATIONS,
    QUEUE_CLASSIFY_QUESTION,
    QUEUE_TOPICS_CATCHUP,
  ]) {
    await boss.createQueue(queue);
  }

  // Idempotent: re-scheduling the same queue replaces the entry, so a redeploy
  // does not stack duplicate crons. Two crons on two queues rather than one
  // housekeeping job: a failure in one must not look like a failure in the other.
  await boss.schedule(QUEUE_MAINTENANCE_PRUNE, "17 * * * *");
  await boss.schedule(QUEUE_GAPS_CATCHUP, "23 * * * *");
  await boss.schedule(QUEUE_PURGE_CONVERSATIONS, "41 * * * *");
  await boss.schedule(QUEUE_TOPICS_CATCHUP, "53 * * * *");

  await boss.work(QUEUE_INGEST_SOURCE, async (jobs) => {
    for (const job of jobs) {
      const payload = IngestSourceJobSchema.parse(job.data);
      console.log(`[ingest.source] ${job.id} source=${payload.sourceId}`);
      await handleIngestSource(boss, db, vectorStore, payload);
    }
  });

  // Throws propagate → pg-boss retries; chunks are replaced, not appended,
  // so a retry lands on the same rows.
  await boss.work(QUEUE_INGEST_DOCUMENT, async (jobs) => {
    for (const job of jobs) {
      const payload = IngestDocumentJobSchema.parse(job.data);
      console.log(`[ingest.document] ${job.id} document=${payload.documentId}`);
      await handleIngestDocument(boss, db, vectorStore, payload);
    }
  });

  // Throws propagate → pg-boss retries; the handler is idempotent
  // (isNull(embedding) filter + upsert).
  await boss.work(QUEUE_EMBED_CHUNKS, async (jobs) => {
    for (const job of jobs) {
      const payload = EmbedChunksJobSchema.parse(job.data);
      console.log(`[embed.chunks] ${job.id} document=${payload.documentId}`);
      await handleEmbedChunks(db, vectorStore, embedder, payload);
    }
  });

  // Housekeeping only — the counters are already correct once a window elapses
  // (spec: widget-abuse-protection). Failing here must never look like an outage.
  await boss.work(QUEUE_MAINTENANCE_PRUNE, async (jobs) => {
    for (const job of jobs) {
      const deleted = await pruneRateLimits(db);
      const expired = await expirePendingActions(db);
      console.log(`[maintenance.prune] ${job.id} removed=${deleted} expired=${expired}`);
    }
  });

  // Serial with everything else (pg-boss defaults), so a full re-index
  // pauses ingestion for its duration — accepted and documented in the
  // handler rather than discovered from "my sources stopped syncing".
  // Throws propagate → pg-boss retries; the version-behind-target predicate
  // makes retries resume, not restart.
  await boss.work(QUEUE_REINDEX_EMBEDDINGS, async (jobs) => {
    for (const job of jobs) {
      const payload = ReindexEmbeddingsJobSchema.parse(job.data);
      console.log(
        `[reindex.embeddings] ${job.id} target=${payload.targetModel} v${payload.targetVersion}`,
      );
      await handleReindexEmbeddings(db, vectorStore, payload);
    }
  });

  // One message, cheap first (exact key before any embedding call). Throws
  // propagate → pg-boss retries; the "already assigned" check makes a retry
  // a no-op.
  await boss.work(QUEUE_ASSIGN_GAP_CLUSTER, async (jobs) => {
    for (const job of jobs) {
      const payload = AssignGapClusterJobSchema.parse(job.data);
      await handleAssignGapCluster(db, embedder, payload, (clusterId) =>
        boss
          .send(QUEUE_ANALYZE_GAP_CLUSTER, {
            orgId: payload.orgId,
            projectId: payload.projectId,
            clusterId,
          })
          .then(() => undefined),
      );
    }
  });

  // Hourly, and on demand for a re-cluster. Serial with everything else, and
  // bounded by the slice size per embedding call.
  await boss.work(QUEUE_GAPS_CATCHUP, async (jobs) => {
    for (const job of jobs) {
      const payload = GapsCatchupJobSchema.parse(job.data ?? {});
      console.log(`[gaps.catchup] ${job.id} project=${payload.projectId ?? "all"}`);
      await handleGapsCatchup(db, embedder, payload);
    }
  });

  // One model call per cluster, budget-checked inside; unchanged material is
  // a no-op. Throws propagate → pg-boss retries; the hash check makes a retry
  // after a stored error re-try the model, which is what an operator wants.
  await boss.work(QUEUE_ANALYZE_GAP_CLUSTER, async (jobs) => {
    for (const job of jobs) {
      const payload = AnalyzeGapClusterJobSchema.parse(job.data);
      await handleAnalyzeGapCluster(db, analyst, payload);
    }
  });

  // One short model call per new conversation, only when the deployment opted
  // in. A renamed or deleted conversation is a no-op; budget refusals are not
  // retried (the day is spent).
  await boss.work(QUEUE_TITLE_CONVERSATION, async (jobs) => {
    for (const job of jobs) {
      const payload = TitleConversationJobSchema.parse(job.data);
      await handleTitleConversation(db, titler, payload);
    }
  });

  // One event, every configured channel; a channel already delivered for
  // this subject is skipped. Throws propagate → pg-boss retries (three
  // times, backing off, per the producer's options); a rejected URL is
  // recorded and not retried. A slow receiver holds this serial worker for
  // at most the delivery timeout per attempt.
  await boss.work(QUEUE_NOTIFICATIONS_DELIVER, async (jobs) => {
    for (const job of jobs) {
      const payload = DeliverNotificationJobSchema.parse(job.data);
      await handleDeliverNotification(db, summarizer, payload);
    }
  });

  // Hourly, and once for a project when its window is saved. Batched and
  // capped per run so a first purge over years of history does not hold this
  // serial worker; the next hour continues. Throws propagate → pg-boss
  // retries; a removed row leaves the predicate, so a retry is harmless.
  await boss.work(QUEUE_PURGE_CONVERSATIONS, async (jobs) => {
    for (const job of jobs) {
      const payload = PurgeConversationsJobSchema.parse(job.data ?? {});
      const summary = await handlePurgeConversations(db, payload);
      for (const p of summary.projects) {
        console.log(
          `[purge.conversations] ${job.id} project=${p.projectId} days=${p.days} removed=${p.removed} capped=${p.capped}`,
        );
      }
    }
  });

  // One short model call per question, only for projects with a topic list.
  // A labelled, removed or topic-less question is a no-op; budget refusals
  // are not retried (the day is spent; the catch-up tries tomorrow).
  await boss.work(QUEUE_CLASSIFY_QUESTION, async (jobs) => {
    for (const job of jobs) {
      const payload = ClassifyQuestionJobSchema.parse(job.data);
      await handleClassifyQuestion(db, classifier, payload);
    }
  });

  // Hourly, and once for a project after its topic list changes. Capped per
  // run so a backlog is worked through over a few hours on this serial worker.
  await boss.work(QUEUE_TOPICS_CATCHUP, async (jobs) => {
    for (const job of jobs) {
      const payload = TopicsCatchupJobSchema.parse(job.data ?? {});
      console.log(`[topics.catchup] ${job.id} project=${payload.projectId ?? "all"}`);
      await handleTopicsCatchup(db, classifier, payload);
    }
  });

  process.on("SIGTERM", () => {
    void boss.stop();
  });

  console.log("deskbell-worker ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
