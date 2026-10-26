import type {
  ActionCallStatus,
  ActionDetail,
  ActionLabels,
  ActionPolicies,
  ActionServerInfo,
  ActionToolDefinition,
  ConversationContext,
  ProjectAnswering,
  ProjectGaps,
  ProjectIdentity,
  ProjectNotifications,
  ProjectTopics,
} from "@deskbell/shared";
import type { WidgetAppearance } from "@deskbell/shared/widget-config";
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Postgres tsvector for the lexical retrieval leg (spec: hybrid-retrieval).
 * Drizzle has no built-in tsvector type; the column is generated in SQL, so
 * the TS-side data type is never written by application code.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * D12: multi-tenant from commit one.
 * - `orgId` on EVERY row; queries go through scoped helpers (see ../index.ts).
 * - RLS policies land in SQL migrations (drizzle-kit custom migration) so
 *   tenant isolation is enforced in the database, not just the app layer.
 * - Free tier = 1 organization, unlimited projects. Multi-org management is EE.
 *
 * Auth tables (users, sessions, accounts, org membership) are owned and
 * migrated by better-auth + its organization plugin — not defined here.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * URL-safe handle required by the better-auth organization plugin
     * (spec: dashboard-auth). Single-org instances never show it; seeded and
     * backfilled from the row id, unique because the plugin resolves by it.
     */
    slug: text("slug").notNull(),
    logo: text("logo"),
    /**
     * Email domains whose people may join on their own by signing in with a
     * configured social provider (spec: sign-in-with-google); validated with
     * SignInDomainsSchema on write. Empty means invitation only.
     */
    allowedSignInDomains: jsonb("allowed_sign_in_domains").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Public key embedded in the widget snippet. Never a secret — origin binding is the control. */
    publicKey: text("public_key").notNull(),
    /** D12 abuse protection: the widget answers only for these origins. */
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    /** Per-project daily LLM token budget; 0 = unlimited (self-host default). */
    dailyTokenBudget: integer("daily_token_budget").notNull().default(0),
    /**
     * Conversation retention (spec: conversation-retention): days a
     * conversation with no new message is kept before the worker's
     * `purge.conversations` job removes it, messages and tool calls included.
     * 0 keeps everything. Validated with ConversationRetentionDaysSchema on
     * write; the predicate lives in `retention.ts` (D12: org-scoped).
     */
    conversationRetentionDays: integer("conversation_retention_days").notNull().default(0),
    /** When the purge job last ran for this project, whatever it removed; the settings status line. */
    conversationsPurgedAt: timestamp("conversations_purged_at", { withTimezone: true }),
    /** What that run removed. */
    conversationsPurgedCount: integer("conversations_purged_count").notNull().default(0),
    /**
     * How the assistant should sound (spec: answer-style): the project's own
     * paragraph, appended to the grounding contract on every answer. Empty
     * means the contract as shipped. Validated with AnswerStyleSchema on
     * write. Read by the ask endpoint only; the public config endpoint never
     * serves it, since the widget has no use for it and a visitor should not
     * read the operator's instructions.
     */
    answerStyle: text("answer_style").notNull().default(""),
    /**
     * Widget appearance authored in the dashboard and served to the widget by
     * GET /api/v1/config. Validated with WidgetAppearanceSchema on write, so
     * client-only options (project key, api url, branding) can never be stored
     * here (spec: widget-customization).
     */
    appearance: jsonb("appearance").$type<Partial<WidgetAppearance>>().notNull().default({}),
    /**
     * End-user identity (spec: end-user-identity): the OpenID issuer whose
     * bearer tokens the widget endpoints verify, validated with
     * ProjectIdentitySchema on write. Empty means anonymous sessions only.
     */
    identity: jsonb("identity").$type<Partial<ProjectIdentity>>().notNull().default({}),
    /**
     * Where the project is told about events (spec: project-notifications):
     * Slack and webhook targets with per-channel event toggles, validated
     * with ProjectNotificationsSchema on write. Holds bearer-equivalent
     * URLs and a signing secret, so it is never served by the public
     * config endpoint and the settings page shows it masked.
     */
    notifications: jsonb("notifications")
      .$type<Partial<ProjectNotifications>>()
      .notNull()
      .default({}),
    /**
     * Gap clustering (spec: gap-cluster-members-and-ignored-terms): the terms
     * stripped from a question before it is embedded, validated with
     * ProjectGapsSchema on write. An absent `ignoredTerms` resolves to the
     * organisation's name; an empty one strips nothing.
     */
    gaps: jsonb("gaps").$type<ProjectGaps>().notNull().default({}),
    /**
     * How the project answers what the content alone cannot (spec:
     * own-data-fallback): `ownDataReply` is shown when a visitor asks about
     * their own account and nothing on the turn can read it. Validated with
     * ProjectAnsweringSchema on write. Server state: never served by the
     * public config endpoint, it reaches the widget on the refusal event.
     */
    answering: jsonb("answering").$type<ProjectAnswering>().notNull().default({}),
    /**
     * What visitors ask about, as the operator names it (spec:
     * question-topics): the list the worker labels each question against,
     * validated with ProjectTopicsSchema on write. Empty means no labelling
     * and no model call.
     */
    topics: jsonb("topics").$type<ProjectTopics>().notNull().default([]),
    /**
     * First-run checklist dismissed (spec: single-tag-embed-deploy-onboarding).
     * The steps themselves are derived from live rows, never stored.
     */
    onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("projects_public_key_idx").on(t.publicKey),
    index("projects_org_idx").on(t.orgId),
  ],
);

/**
 * A signed-in visitor, as the project's identity provider names them (spec:
 * end-user-identity). One row per (project, issuer, subject); the profile
 * fields are refreshed from the token on every request. Conversations point
 * here so a person's threads follow them across browsers.
 */
export const endUsers = pgTable(
  "end_users",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    name: text("name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("end_users_org_idx").on(t.orgId),
    uniqueIndex("end_users_project_subject_idx").on(t.projectId, t.issuer, t.subject),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Connector type from @deskbell/connectors registry, e.g. "docs-crawler", "confluence". */
    type: text("type").notNull(),
    /** Connector-specific config, validated by the connector's manifest schema. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["pending", "syncing", "ready", "error"] })
      .notNull()
      .default("pending"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("sources_org_idx").on(t.orgId),
    index("sources_project_idx").on(t.projectId),
    // One corrections source per project (spec: corrections-source): the
    // dashboard inserts on first use, and two editors saving at once must
    // not end up with two.
    uniqueIndex("sources_project_corrections_idx").on(t.projectId).where(sql`type = 'corrections'`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url"),
    title: text("title").notNull(),
    /** Skip re-embedding unchanged docs on re-sync. */
    contentHash: text("content_hash").notNull(),
    /**
     * The page text as the connector emitted it, before chunking (spec:
     * contextual-chunks). Null for rows ingested before the column existed;
     * the next sync fills it without re-chunking when the hash is unchanged.
     * Kept so a short page can later be handed to the model whole, and so
     * the embedding input can be measured against the page it came from.
     */
    content: text("content"),
    ...timestamps,
  },
  (t) => [index("documents_org_idx").on(t.orgId), index("documents_source_idx").on(t.sourceId)],
);

/**
 * Embedding dimension is fixed per deployment. A model with a different
 * dimension cannot be written into the column: the reindex.embeddings job
 * probes and refuses the mismatch, naming the vector-column migration it
 * needs first — never an in-place alter (see AGENTS.md). Model + version
 * live on each row so a re-index can tell current from stale (D12).
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /**
     * Denormalised from sources via documents (spec: hybrid-retrieval §0).
     * With the tenant predicate two joins away the planner can neither use
     * nor safely post-filter the vector index; scoping retrieval on this
     * column is what makes the single-table query shape possible. Written at
     * ingest; the migration backfilled existing rows.
     */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * 0-based index of this chunk within its document. Nullable: rows
     * ingested before this column existed cannot be backfilled (chunk ids
     * are random and a document's rows share a timestamp) and are fixed by
     * re-syncing the source (spec: hybrid-retrieval §1).
     */
    position: integer("position"),
    content: text("content").notNull(),
    /**
     * The vector — when the pgvector driver holds it. Null for a chunk that
     * is not indexed yet, and null for good on a driver that keeps vectors
     * in its own store (spec: vector-store-single-home). Never the pending
     * predicate: that is `vectorStore`.
     */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    embeddingVersion: integer("embedding_version").notNull().default(1),
    /**
     * Which store holds this chunk's vector — `pgvector`, or
     * `weaviate:<collection>` — and the one place a vector lives (spec:
     * vector-store-single-home). Null means not indexed yet: the embed job
     * selects on it, and the Sources page counts on it. A value other than
     * the configured store means the operator changed drivers and a
     * re-index has not moved this chunk yet.
     */
    vectorStore: text("vector_store"),
    /**
     * Ingest-time injection heuristics that fired on this chunk; null when
     * none did (spec: ingestion-pipeline). Flagging is NOT filtering — a
     * flagged chunk stays retrievable, because silently dropping it deletes
     * part of a customer's documentation on a heuristic's say-so. Recorded
     * so the operator can see what and why, and so a later decision about
     * acting on the flag has data instead of guesses.
     */
    injectionSignals: text("injection_signals").array(),
    /**
     * Lexical leg (spec: hybrid-retrieval §1): a STORED generated column, not
     * an expression index — greppable and EXPLAIN-verifiable, where an
     * expression index silently stops matching the moment the query-side
     * expression drifts a character. The `deskbell_search` text-search
     * configuration (simple + unaccent, created in the same migration) is a
     * constant, which is what keeps to_tsvector() immutable here. Unstemmed
     * on purpose: the vector leg owns morphology and paraphrase; this leg
     * exists for exact tokens — error codes, config keys, identifiers.
     */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('deskbell_search', "content")`,
    ),
    ...timestamps,
  },
  (t) => [
    index("chunks_org_idx").on(t.orgId),
    index("chunks_document_idx").on(t.documentId),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    // Leading org_id also satisfies the rule-3 org index requirement.
    index("chunks_org_project_idx").on(t.orgId, t.projectId),
    index("chunks_search_tsv_idx").using("gin", t.searchTsv),
  ],
);

/**
 * Install verification (spec: single-tag-embed-deploy-onboarding): one row per
 * (project, origin) the widget has been seen on, upserted by /api/v1/ping
 * (mounted) and /api/v1/ask (answered) — see apps/web/lib/installs.ts.
 * Diagnostic, never authorization — non-allowlisted origins are recorded on
 * purpose so the Deploy page can flag "widget seen on X, not in your allowlist".
 */
export const widgetInstalls = pgTable(
  "widget_installs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Browser Origin header in canonical form (scheme://host[:port]). */
    origin: text("origin").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("widget_installs_org_idx").on(t.orgId),
    uniqueIndex("widget_installs_project_origin_idx").on(t.projectId, t.origin),
  ],
);

/**
 * Fixed-window request counters (spec: widget-abuse-protection). One row per
 * (bucket, window); `key` encodes the scope, the salted subject hash, and the
 * window start, so a whole request's buckets are one batched upsert.
 *
 * DELIBERATE D12 EXCEPTION — no `org_id`. This is an operational table in the
 * same category as pg-boss's own: it holds no tenant data (keys are salted
 * hashes) and its per-IP buckets are cross-tenant by nature — one abuser
 * hitting five projects must be one bucket, not five. Recorded in the spec.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    /** Pruned hourly by the worker's maintenance.prune job — never on the request path. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_expires_idx").on(t.expiresAt)],
);

/**
 * Daily LLM spend per project, enforced against `projects.daily_token_budget`
 * (spec: widget-abuse-protection). Written after each answer completes and read
 * before the next one starts, so a request may overshoot the budget by one
 * answer — see the spec for why a reservation is the wrong trade here.
 *
 * `day` is a UTC date, so a budget means the same thing on every deployment.
 */
export const tokenUsage = pgTable(
  "token_usage",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    embeddingTokens: integer("embedding_tokens").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("token_usage_org_idx").on(t.orgId),
    uniqueIndex("token_usage_project_day_idx").on(t.projectId, t.day),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    /**
     * The verified visitor, when the project verifies identity (spec:
     * end-user-identity). Ownership is this column when set, the session
     * otherwise. Null for anonymous conversations.
     */
    endUserId: text("end_user_id").references(() => endUsers.id, { onDelete: "set null" }),
    /** The first question, or what the titling job or the visitor wrote (spec: conversation-context-and-titles). */
    title: text("title"),
    /** Host-page context attached at creation; never interpreted, only filtered and shown. */
    context: jsonb("context").$type<ConversationContext>(),
    /**
     * Soft delete: hidden from every visitor-facing list and read, kept for
     * the dashboard until the project's retention window removes it (spec:
     * conversation-retention).
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("conversations_org_idx").on(t.orgId),
    index("conversations_session_idx").on(t.sessionId),
    // messages carries no project id, so every dashboard read that is
    // project- and period-bounded joins through here (spec: answer-signal).
    index("conversations_project_created_idx").on(t.projectId, t.createdAt),
    // A signed-in visitor's thread list, newest first.
    index("conversations_project_end_user_idx").on(t.projectId, t.endUserId, t.updatedAt),
    // Usage filters ask for conversations whose context carries one key with
    // one id, as a containment test (spec: usage-page); jsonb_path_ops is the
    // index that answers containment.
    index("conversations_context_idx").using("gin", t.context.op("jsonb_path_ops")),
  ],
);

/** What the analyst wrote about a cluster, and what it was written from (spec: gap-analysis). */
export interface StoredGapAnalysis {
  title: string;
  finding: string;
  recommendation: string;
  suggestedFacts: string[];
  model: string;
  analyzedAt: string;
  /** Hash of the phrasings, evidence and model; unchanged material is not re-analysed. */
  inputHash: string;
}

/**
 * One row per need (spec: gap-clusters): gap questions grouped by meaning,
 * assigned incrementally by the worker. Only the leader carries a vector —
 * a question is a few tokens to embed, so a re-cluster re-embeds everything
 * rather than every message row carrying six kilobytes it never reads.
 */
export const gapClusters = pgTable(
  "gap_clusters",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The first phrasing seen; what the page shows. */
    label: text("label").notNull(),
    /** The label normalised — exact matches join without an embedding call. */
    normalizedKey: text("normalized_key").notNull(),
    /**
     * The model the cluster's leader phrasing was embedded with; null until it
     * has been. Vectors live on `gap_phrasings` — this is what the dashboard's
     * stale-model notice reads.
     */
    embeddingModel: text("embedding_model"),
    embeddingVersion: integer("embedding_version").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    /** Set when an occurrence after resolved_at reopened the cluster. */
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    /** The stored analysis (spec: gap-analysis); null until an operator or the auto rule asks for one. */
    analysis: jsonb("analysis").$type<StoredGapAnalysis>(),
    /** Set when analysis was requested and cleared when it lands or is skipped — the pending mark. */
    analysisRequestedAt: timestamp("analysis_requested_at", { withTimezone: true }),
    analysisRequestedBy: text("analysis_requested_by"),
    /** Why the last request produced nothing; cleared by the next success. */
    analysisError: text("analysis_error"),
    /**
     * The answer written for this cluster (spec: corrections-source); null
     * until an editor writes one, and null again when it is deleted. The
     * status is not tied to it: deleting the answer keeps the cluster resolved.
     */
    correctionDocumentId: text("correction_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("gap_clusters_org_idx").on(t.orgId),
    uniqueIndex("gap_clusters_project_key_idx").on(t.projectId, t.normalizedKey),
    index("gap_clusters_project_status_idx").on(t.orgId, t.projectId, t.status, t.lastSeen),
    index("gap_clusters_correction_document_idx").on(t.correctionDocumentId),
  ],
);

/**
 * One row per distinct wording of a gap question in a project (spec:
 * gap-cluster-members-and-ignored-terms). A new phrasing is compared with
 * every one of these, not with cluster leaders only, so a cluster keeps
 * absorbing paraphrases of the wordings it already holds.
 *
 * A vector per wording, never per message: a hundred repeats of one question
 * embed once. Exact scan under the tenant filter, no approximate index —
 * wordings per project number in the low thousands.
 */
export const gapPhrasings = pgTable(
  "gap_phrasings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => gapClusters.id, { onDelete: "cascade" }),
    /** The question as first typed with this wording. */
    text: text("text").notNull(),
    /** `normalizeQuestion(text)` — the exact-match key, unique in the project. */
    normalizedKey: text("normalized_key").notNull(),
    /** Null when the embedder was unavailable; healed by the catch-up pass. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("gap_phrasings_org_idx").on(t.orgId),
    uniqueIndex("gap_phrasings_project_key_idx").on(t.projectId, t.normalizedKey),
    index("gap_phrasings_cluster_idx").on(t.clusterId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<unknown[]>(),
    refused: boolean("refused").notNull().default(false),
    /**
     * This assistant turn asked the visitor a clarifying question instead of
     * answering (spec: clarifying-questions). Never a gap on its own: not a
     * refusal, and the weak-answer floor is a property of an answer.
     */
    clarified: boolean("clarified").notNull().default(false),
    /** Analytics: was a cited document actually helpful? Set by widget feedback. */
    feedback: text("feedback", { enum: ["up", "down"] }),
    /** Downvote follow-up (spec: widget-feedback); cleared with the vote. */
    /** A reason id the project configured; the built-in ids are incorrect, irrelevant, unaddressed. */
    feedbackReason: text("feedback_reason"),
    feedbackComment: text("feedback_comment"),
    /**
     * What the engine knew when it answered (spec: answer-signal). All nullable:
     * rows written before the columns existed classify from `refused` and
     * `feedback` alone, and a null never flags a row as a gap.
     */
    retrievalHits: integer("retrieval_hits"),
    /** Highest cosine among the retrieved chunks; null when none carried a score. */
    retrievalTopScore: real("retrieval_top_score"),
    retrievalMeanScore: real("retrieval_mean_score"),
    /** Why a refusal happened; null on an answer. */
    refusalReason: text("refusal_reason", {
      enum: ["no_context", "no_grounding", "off_topic", "guardrail", "no_access"],
    }),
    /** Whether the model named the sources it used; false = citations are the whole retrieved set. */
    sourcesNamed: boolean("sources_named"),
    latencyMs: integer("latency_ms"),
    /** The chat model configured when the answer was written. */
    model: text("model"),
    /**
     * Names the answer asserted that were found neither in the retrieved
     * blocks nor anywhere in the corpus (spec: answer-verification). Three
     * states, never collapsed: null — not checked (verification off, a
     * refusal, a clarification, or the lookup failed); empty — checked and
     * clean; non-empty — the names, as the answer wrote them. Non-empty is
     * a gap on its own.
     */
    unsupportedTerms: text("unsupported_terms").array(),
    /** The gap cluster this (assistant) message was assigned to (spec: gap-clusters). */
    gapClusterId: text("gap_cluster_id").references(() => gapClusters.id, {
      onDelete: "set null",
    }),
    /**
     * The project topic this (user) message was labelled with (spec:
     * question-topics): a key from the project's list, or `other`. Null
     * until the worker runs, or forever when the project has no topics.
     */
    topic: text("topic"),
    ...timestamps,
  },
  (t) => [
    index("messages_org_idx").on(t.orgId),
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_org_created_idx").on(t.orgId, t.createdAt),
    index("messages_gap_cluster_idx").on(t.gapClusterId),
    // The visitor-flagged gap rows. The weak-answer floor is an environment
    // value and cannot live in a partial index; those rows are found through
    // the period bound above.
    index("messages_gap_idx")
      .on(t.conversationId, t.createdAt)
      .where(sql`role = 'assistant' and (refused or feedback = 'down')`),
    // The questions the topic catch-up still has to label.
    index("messages_topic_pending_idx")
      .on(t.conversationId, t.createdAt)
      .where(sql`role = 'user' and topic is null`),
  ],
);

/**
 * One row per (project, event, subject, channel) a notification was attempted
 * for (spec: project-notifications). The dispatcher skips channels already
 * delivered, so a retry after a partial failure re-sends only the channel
 * that failed; the settings page reads the latest row per channel for its
 * status line. `subject_key` is the event's subject id — the message id for
 * feedback events.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    subjectKey: text("subject_key").notNull(),
    channel: text("channel").notNull(),
    status: text("status", { enum: ["delivered", "rejected"] }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Why it was rejected, for the status line; null on success. */
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    index("notification_deliveries_org_idx").on(t.orgId),
    uniqueIndex("notification_deliveries_subject_idx").on(
      t.projectId,
      t.event,
      t.subjectKey,
      t.channel,
    ),
    index("notification_deliveries_project_channel_idx").on(t.projectId, t.channel, t.createdAt),
  ],
);

/**
 * A remote MCP server attached to a project (spec: mcp-actions). The tools it
 * exposes are discovered from it and snapshotted here (`tools`, `server_info`,
 * `initialize_result`) so the settings page renders without a live server and
 * a request can build its tool set without a handshake. `policies` maps a
 * tool name to off | allow | confirm; a tool with no entry is off. The
 * credential is stored as written and masked on read, like the notification
 * targets; the public config endpoint never serves this table.
 */
export const actionServers = pgTable(
  "action_servers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Namespaces the tools (`<slug>__<tool>`) and is the identity token's audience. */
    slug: text("slug").notNull(),
    url: text("url").notNull(),
    transport: text("transport", { enum: ["http", "sse"] })
      .notNull()
      .default("http"),
    authKind: text("auth_kind", { enum: ["none", "bearer", "header"] })
      .notNull()
      .default("none"),
    authHeaderName: text("auth_header_name"),
    authSecret: text("auth_secret"),
    identity: text("identity", { enum: ["none", "signed", "visitor"] })
      .notNull()
      .default("none"),
    /**
     * With `identity = visitor`, the OAuth client the visitor's token is
     * exchanged with (spec: visitor-token-actions); null client id means the
     * token is forwarded unchanged. The secret is handled like `auth_secret`.
     */
    exchangeClientId: text("exchange_client_id"),
    exchangeClientSecret: text("exchange_client_secret"),
    exchangeAudience: text("exchange_audience"),
    exchangeScope: text("exchange_scope"),
    enabled: boolean("enabled").notNull().default(true),
    policies: jsonb("policies").$type<ActionPolicies>().notNull().default({}),
    /** What each tool is called in the widget (spec: action-presentation). */
    labels: jsonb("labels").$type<ActionLabels>().notNull().default({}),
    tools: jsonb("tools").$type<ActionToolDefinition[]>(),
    toolsFetchedAt: timestamp("tools_fetched_at", { withTimezone: true }),
    serverInfo: jsonb("server_info").$type<ActionServerInfo>(),
    /** The raw initialize result, reused so a request skips the handshake. */
    initializeResult: jsonb("initialize_result").$type<Record<string, unknown>>(),
    status: text("status", { enum: ["ok", "error", "unreachable"] }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("action_servers_org_idx").on(t.orgId),
    uniqueIndex("action_servers_project_slug_idx").on(t.projectId, t.slug),
  ],
);

/**
 * The audit log of actions (spec: mcp-actions; D7): one row per attempted
 * tool call, whatever became of it. A call that needs confirmation is stored
 * here while it waits — `resume_messages` holds the model messages of the
 * paused step, `approval_id` and `approval_signature` what the visitor's
 * answer must match — and the row is what the widget replays as a card.
 * `message_id` is set once the assistant message the call belongs to exists.
 * Output is truncated at write time; `output_truncated` says so.
 */
export const actionCalls = pgTable(
  "action_calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    serverId: text("server_id").references(() => actionServers.id, { onDelete: "set null" }),
    /** The tool as the server names it, without the slug prefix. */
    tool: text("tool").notNull(),
    title: text("title").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<unknown>(),
    outputTruncated: boolean("output_truncated").notNull().default(false),
    status: text("status", {
      enum: ["running", "succeeded", "failed", "pending_approval", "approved", "denied", "expired"],
    })
      .$type<ActionCallStatus>()
      .notNull(),
    summary: text("summary"),
    /** The arguments as the confirmation card showed them (spec: action-presentation). */
    details: jsonb("details").$type<ActionDetail[]>(),
    /** The model's own id for the call, so a resumed turn's result finds this row. */
    toolCallId: text("tool_call_id"),
    approvalId: text("approval_id"),
    approvalSignature: text("approval_signature"),
    resumeMessages: jsonb("resume_messages").$type<unknown[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    endUserId: text("end_user_id").references(() => endUsers.id, { onDelete: "set null" }),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    index("action_calls_org_idx").on(t.orgId),
    index("action_calls_project_created_idx").on(t.projectId, t.createdAt),
    index("action_calls_conversation_idx").on(t.conversationId),
    index("action_calls_message_idx").on(t.messageId),
    uniqueIndex("action_calls_approval_idx").on(t.approvalId),
  ],
);

/**
 * Keys this instance signs visitor identity tokens with (spec: mcp-actions,
 * Identity). Generated on first use; the public halves are served at
 * `/api/v1/actions/jwks`. A retired key stays published for a grace period so
 * a token minted just before rotation still verifies.
 *
 * DELIBERATE D12 EXCEPTION — no `org_id`, like `rate_limits`: the key belongs
 * to the deployment, not to a tenant. Tokens name the project in a claim.
 */
export const signingKeys = pgTable(
  "signing_keys",
  {
    kid: text("kid").primaryKey(),
    alg: text("alg").notNull(),
    publicJwk: jsonb("public_jwk").$type<Record<string, unknown>>().notNull(),
    privateJwk: jsonb("private_jwk").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [index("signing_keys_active_idx").on(t.retiredAt, t.createdAt)],
);
