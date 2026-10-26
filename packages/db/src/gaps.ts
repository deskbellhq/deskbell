import type { ProjectGaps } from "@deskbell/shared";
import { and, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";

import type { Database } from "./index";
import { messages, organizations, projects } from "./schema";

/**
 * What the dashboard, the worker and the exports share about docs gaps
 * (spec: gap-clusters). One definition of "the question a gap row
 * answered", one of "is this row a gap", one normalisation — so the worker
 * assigning clusters and the page reading them cannot drift apart.
 */

/**
 * Case, whitespace and trailing punctuation do not make two questions
 * different. Paraphrases are the clusters' job.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!\s]+$/g, "");
}

/**
 * Words that carry no meaning in this project's questions — the product's or
 * organisation's name, repeated in nearly every one of them — removed before
 * the question is embedded (spec: gap-cluster-members-and-ignored-terms).
 * Case-insensitive and whole-word, so "Deskbell" goes and "Deskbells" stays;
 * a term may be several words.
 *
 * Never applied to the label, the key or the export: it changes what the
 * clustering compares, not what anyone reads. If stripping would leave
 * nothing, the question is embedded as typed — "Deskbell?" is a question
 * about the product, not an empty string.
 */
export function stripIgnoredTerms(text: string, terms: readonly string[]): string {
  let out = text;
  for (const term of terms) {
    const pattern = term
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    if (!pattern) continue;
    // Not \b: a term may end in punctuation, and the interesting boundary is
    // a hostname. "Deskbell?" is the product; "deskbell.dev" is an address,
    // so a dot followed by a word character is part of the word too.
    out = out.replace(new RegExp(`(?<!\\w|\\w\\.)${pattern}(?!\\w|\\.\\w)`, "gi"), " ");
  }
  out = out
    .replace(/\s+/g, " ")
    .replace(/\s+([?!.,;:])/g, "$1")
    .trim();
  // Nothing but punctuation left: the name was the whole question, so the
  // question is embedded as typed rather than as "?".
  return /[\p{L}\p{N}]/u.test(out) ? out : text;
}

/**
 * The terms a project strips. An absent list means the project has never been
 * configured and resolves to the organisation's name; an empty one is an
 * operator saying "strip nothing", which is why the two are stored apart.
 */
export function effectiveIgnoredTerms(
  gaps: ProjectGaps | null | undefined,
  orgName: string | null | undefined,
): string[] {
  if (gaps?.ignoredTerms) return gaps.ignoredTerms;
  const name = orgName?.trim();
  return name ? [name] : [];
}

/** The same, read from the project and its organisation. */
export async function readIgnoredTerms(
  db: Database,
  scope: { orgId: string; projectId: string },
): Promise<string[]> {
  const [row] = await db
    .select({ gaps: projects.gaps, orgName: organizations.name })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
    .limit(1);
  return effectiveIgnoredTerms(row?.gaps, row?.orgName);
}

/**
 * The question an assistant message answered: the closest preceding user
 * turn in the same conversation, as a correlated subquery so there is no
 * per-row round trip.
 *
 * The outer columns are written out as "messages"."…" on purpose. Drizzle
 * renders a column reference unqualified when the query has no join, and
 * inside the subquery an unqualified `conversation_id` resolves to the
 * alias `u` — the subquery stops correlating and every row gets the newest
 * user message in the table. Only valid in a query whose FROM is the
 * messages table, unaliased.
 */
export const gapQuestionSql = sql<
  string | null
>`(select u.content from ${messages} u where u.conversation_id = "messages"."conversation_id" and u.role = 'user' and u.created_at <= "messages"."created_at" order by u.created_at desc limit 1)`;

/**
 * Refusal reasons the docs did not cause (spec: refusal-scope-and-thread-counts).
 * `guardrail` is what the ask route records when the engine throws — an outage
 * or a bug, not a missing page. `off_topic` is a question the docs were never
 * meant to answer. `no_access` is a question about the visitor's own data,
 * which no page can hold (spec: own-data-fallback). All three stay refusals
 * everywhere a refusal is shown; none is a gap. Keep in step with
 * `classifyAnswer` in the web app.
 */
export const NON_GAP_REFUSAL_REASONS = ["guardrail", "off_topic", "no_access"] as const;

/**
 * The signals that make an assistant message a gap (spec: answer-signal):
 * refused, marked down, answered from a best match under the weak-answer
 * floor, or answered with a name the corpus does not contain (spec:
 * answer-verification). Nulls never match, so rows written before the
 * signal columns existed qualify only on the first two — and a null reason
 * on a refusal still counts, since those rows predate the column.
 *
 * A clarifying question (spec: clarifying-questions) is not an answer, so
 * the floor does not apply to it; a downvote on one still counts.
 */
export function isGapPredicate(weakScore: number) {
  return and(
    eq(messages.role, "assistant"),
    or(
      and(
        eq(messages.refused, true),
        or(
          isNull(messages.refusalReason),
          not(inArray(messages.refusalReason, [...NON_GAP_REFUSAL_REASONS])),
        ),
      ),
      eq(messages.feedback, "down"),
      and(eq(messages.clarified, false), lt(messages.retrievalTopScore, weakScore)),
      // Named something the corpus does not contain (spec:
      // answer-verification). Null means unchecked and never flags.
      sql`coalesce(cardinality(${messages.unsupportedTerms}), 0) > 0`,
    ),
  );
}

export interface GapsConfig {
  /**
   * Top-score floor under which an answered question counts as a weak answer
   * (spec: answer-signal). A property of the embedding model: the default is
   * calibrated on the shipped one, and a different model moves the scale.
   */
  weakScore: number;
}

/** Calibrated on the private tuning set — see spec answer-signal, Measurements. */
export const GAPS_DEFAULTS: GapsConfig = { weakScore: 0.35 };

/** Malformed values warn and fall back: an env typo may misclassify a row, never take a page down. */
export function readGapsConfig(env: Record<string, string | undefined> = process.env): GapsConfig {
  const raw = env.DESKBELL_GAPS_WEAK_SCORE;
  if (raw === undefined || raw.trim() === "") return { ...GAPS_DEFAULTS };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    console.warn(`[gaps] ignoring DESKBELL_GAPS_WEAK_SCORE="${raw}" — expected a number in [0, 1)`);
    return { ...GAPS_DEFAULTS };
  }
  return { weakScore: value };
}

export interface ClusterConfig {
  /**
   * Cosine similarity at or above which a question joins an existing
   * cluster instead of starting one. A property of the embedding model;
   * see the spec's Measurements for how the default was chosen.
   */
  similarity: number;
  /**
   * Occurrences in the last 30 days at which a cluster without an analysis
   * is analysed without a click (spec: gap-analysis). 0 = never; the
   * default, because automatic spend is something a self-hoster turns on.
   */
  autoAnalyzeAt: number;
}

/** Similarity measured on the shipped embedding model — see spec gap-clusters, Measurements. */
export const CLUSTER_DEFAULTS: ClusterConfig = { similarity: 0.8, autoAnalyzeAt: 0 };

/** Malformed values warn and fall back — a typo may over- or under-group, never stop assignment. */
export function readClusterConfig(
  env: Record<string, string | undefined> = process.env,
): ClusterConfig {
  const config = { ...CLUSTER_DEFAULTS };
  const rawSimilarity = env.DESKBELL_GAPS_CLUSTER_SIMILARITY;
  if (rawSimilarity !== undefined && rawSimilarity.trim() !== "") {
    const value = Number(rawSimilarity);
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      console.warn(
        `[gaps] ignoring DESKBELL_GAPS_CLUSTER_SIMILARITY="${rawSimilarity}" — expected a number in (0, 1]`,
      );
    } else {
      config.similarity = value;
    }
  }
  const rawAuto = env.DESKBELL_GAPS_AUTO_ANALYZE_AT;
  if (rawAuto !== undefined && rawAuto.trim() !== "") {
    const value = Number(rawAuto);
    if (!Number.isInteger(value) || value < 0) {
      console.warn(
        `[gaps] ignoring DESKBELL_GAPS_AUTO_ANALYZE_AT="${rawAuto}" — expected an integer >= 0`,
      );
    } else {
      config.autoAnalyzeAt = value;
    }
  }
  return config;
}
