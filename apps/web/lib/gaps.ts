import { normalizeQuestion, type StoredGapAnalysis } from "@deskbell/db";
import { ACTION_CITATION_KIND, type Citation, GAP_ANALYSIS_BUDGET_ERROR } from "@deskbell/shared";

import { parseCitations, uniqueByDocument } from "./conversation";
import {
  ANALYSIS_PENDING_TTL_MS,
  ANALYZE_ALL_CAP,
  type AnalysisCounts,
  type AnalysisFailure,
} from "./gap-analysis-ui";
import { type AnswerSignal, classifyAnswer, GAPS_DEFAULTS, type GapsConfig } from "./gaps-signal";
import {
  DEFAULT_PERIOD,
  DEFAULT_SORT,
  DEFAULT_STATUS,
  type PeriodKey,
  type SortKey,
  type StatusCounts,
  type StatusKey,
} from "./gaps-view";

// The URL state lives in ./gaps-view so client components can import it
// without this module's database imports; server code reads it from here.
export * from "./gaps-view";
export { normalizeQuestion };

/**
 * Gaps (spec: docs-gaps-page): the questions the content could not
 * answer, grouped so a question asked five times is one row with a five.
 *
 * Pure functions over rows the page already fetched — the query stays in the
 * page, the shaping stays testable without a database.
 */

/**
 * One refused, downvoted or weakly-evidenced assistant message, with the
 * question it answered. The signal columns are nullable on purpose: a row
 * from before they existed classifies from `refused` and `feedback` alone.
 */
export interface GapRow extends AnswerSignal {
  messageId: string;
  conversationId: string;
  question: string | null;
  feedbackReason: string | null;
  feedbackComment: string | null;
  citations: unknown[] | null;
  createdAt: Date;
  /** The cluster the worker assigned this row to (spec: gap-clusters); null until it runs. */
  gapClusterId: string | null;
  cluster: GapClusterInfo | null;
}

export interface GapClusterInfo {
  label: string;
  status: "open" | "resolved";
  resolvedAt: Date | null;
  reopenedAt: Date | null;
  embeddingModel: string | null;
  /** The analyst's output (spec: gap-analysis); null until requested. */
  analysis: StoredGapAnalysis | null;
  analysisRequestedAt: Date | null;
  analysisError: string | null;
  /** The answer written for this cluster (spec: corrections-source); null until there is one. */
  correctionDocumentId: string | null;
}

export interface GapEvidence {
  documentId: string;
  title: string;
  url?: string;
  /** The source type the citation carried (spec: answer-citation-labels); absent on older rows. */
  kind?: string;
  /** Occurrences across the group's messages. */
  count: number;
}

export interface GapGroup {
  key: string;
  /** The cluster's label, or the question as first typed when unclustered. */
  question: string;
  /** Null for a group of rows the worker has not assigned yet. */
  clusterId: string | null;
  status: "open" | "resolved";
  /** Distinct phrasings in the group, first seen first. */
  variants: string[];
  /** The cluster reopened after being resolved — the fix did not hold. */
  reopenedAt: Date | null;
  analysis: StoredGapAnalysis | null;
  /** When an analysis was last requested; null once the worker answered. */
  analysisRequestedAt: Date | null;
  /**
   * Requested, not yet answered, and not yet given up on: a request older
   * than `ANALYSIS_PENDING_TTL_MS` reads as lost, not pending.
   */
  analysisPending: boolean;
  analysisError: string | null;
  /** The stored error, classified; null while a fresh request is pending. */
  analysisFailure: AnalysisFailure | null;
  /** The answer written for this cluster; null until there is one. */
  correctionDocumentId: string | null;
  count: number;
  refusals: number;
  downvotes: number;
  /** Answered, but the best retrieved match scored under the floor. */
  weak: number;
  /** Answered with a name the documentation does not contain (spec: answer-verification). */
  unsupported: number;
  /** Those names → how many of the group's answers used each, most used first. */
  unsupportedTerms: Array<{ term: string; count: number }>;
  /** Answered, and the model named no source, so it cited everything retrieved. */
  unsourced: number;
  firstSeen: Date;
  lastSeen: Date;
  latestConversationId: string;
  latestMessageId: string;
  /** Downvote reasons → occurrences. */
  reasons: Record<string, number>;
  comments: string[];
  /** What retrieval FOUND on refusals — the engine's retrieval set. */
  found: GapEvidence[];
  /** What the answer CITED on downvotes. */
  cited: GapEvidence[];
  /** When each occurrence happened — the input to the recency weight. */
  occurrences: Date[];
}

/* ------------------------------------------------------------------------ */
/* Period, trend and order (spec: gaps-period-and-ordering)                   */
/* ------------------------------------------------------------------------ */

const PERIOD_DAYS: Record<Exclude<PeriodKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface Period {
  key: PeriodKey;
  /** Start of the window, or null for all time. */
  from: Date | null;
  /** Start of the equal-length window before it; null when there is none. */
  previousFrom: Date | null;
}

const isBoundedPeriod = (key: string | undefined): key is Exclude<PeriodKey, "all"> =>
  key !== undefined && Object.hasOwn(PERIOD_DAYS, key);

/** Anything unrecognised is the default: a bad link shows the usual view. */
export function resolvePeriod(param: string | string[] | undefined, now: Date): Period {
  const key = Array.isArray(param) ? param[0] : param;
  if (key === "all") return { key, from: null, previousFrom: null };
  const resolved = isBoundedPeriod(key) ? key : DEFAULT_PERIOD;
  const ms = PERIOD_DAYS[resolved] * 86_400_000;
  return {
    key: resolved,
    from: new Date(now.getTime() - ms),
    previousFrom: new Date(now.getTime() - 2 * ms),
  };
}

export function resolveSort(param: string | string[] | undefined): SortKey {
  const key = Array.isArray(param) ? param[0] : param;
  return key === "frequent" || key === "trending" ? key : DEFAULT_SORT;
}

/* ------------------------------------------------------------------------ */
/* Status (spec: gaps-status-filter)                                          */
/* ------------------------------------------------------------------------ */

export function resolveStatus(param: string | string[] | undefined): StatusKey {
  const key = Array.isArray(param) ? param[0] : param;
  return key === "resolved" || key === "all" ? key : DEFAULT_STATUS;
}

/** Status is a property of the cluster, so the same filter applies to any window. */
export function filterByStatus<T extends { status: "open" | "resolved" }>(
  groups: T[],
  status: StatusKey,
): T[] {
  return status === "all" ? groups : groups.filter((g) => g.status === status);
}

/** What each view would show, from the unfiltered groups of the period. */
export function countByStatus(groups: { status: "open" | "resolved" }[]): StatusCounts {
  const resolved = groups.filter((g) => g.status === "resolved").length;
  return { open: groups.length - resolved, resolved, all: groups.length };
}

/** Seven days: about how often documentation gets edited. */
export const RECENCY_HALF_LIFE_DAYS = 7;

/**
 * Every occurrence weighted by its age with a fixed half-life, summed. One
 * occurrence today is 1.0; two from seventeen days ago together are about
 * 0.37; two from yesterday about 1.8. A burst still wins; a stale pair does
 * not — which is the ordering bug this exists to fix.
 */
export function recencyWeight(
  occurrences: readonly Date[],
  now: Date,
  halfLifeDays = RECENCY_HALF_LIFE_DAYS,
): number {
  let weight = 0;
  for (const at of occurrences) {
    const ageDays = Math.max(0, now.getTime() - at.getTime()) / 86_400_000;
    weight += 2 ** (-ageDays / halfLifeDays);
  }
  return weight;
}

export type Trend = "new" | "up" | "down" | "flat";

export interface GapGroupWithTrend extends GapGroup {
  /** Occurrences in the previous window; 0 when there was none. */
  previousCount: number;
  /** Null when the period has no previous window (all time). */
  trend: Trend | null;
  recency: number;
}

/** A quarter either way is a move; less is noise on counts this small. */
const TREND_STEP = 0.25;

export function attachTrend(
  groups: GapGroup[],
  previous: GapGroup[],
  period: Period,
  now: Date,
): GapGroupWithTrend[] {
  const before = new Map(previous.map((g) => [g.key, g.count]));
  return groups.map((g) => {
    const previousCount = before.get(g.key) ?? 0;
    let trend: Trend | null = null;
    if (period.previousFrom !== null) {
      if (previousCount === 0) trend = "new";
      else if (g.count >= previousCount * (1 + TREND_STEP)) trend = "up";
      else if (g.count <= previousCount * (1 - TREND_STEP)) trend = "down";
      else trend = "flat";
    }
    return { ...g, previousCount, trend, recency: recencyWeight(g.occurrences, now) };
  });
}

/**
 * Stable, total, clock-free: `now` is an input, so a test never waits for
 * one. Resolved clusters sink below open ones whatever the order, which
 * matters in the view that shows both (spec: gaps-status-filter).
 */
export function compareGroups(
  sort: SortKey,
): (a: GapGroupWithTrend, b: GapGroupWithTrend) => number {
  const byCount = (a: GapGroupWithTrend, b: GapGroupWithTrend) =>
    b.count - a.count || b.lastSeen.getTime() - a.lastSeen.getTime();
  const byStatus = (a: GapGroupWithTrend, b: GapGroupWithTrend) =>
    Number(a.status === "resolved") - Number(b.status === "resolved");
  switch (sort) {
    case "frequent":
      return (a, b) => byStatus(a, b) || byCount(a, b);
    case "trending":
      return (a, b) =>
        byStatus(a, b) || b.count - b.previousCount - (a.count - a.previousCount) || byCount(a, b);
    default:
      return (a, b) => byStatus(a, b) || b.recency - a.recency || byCount(a, b);
  }
}

export function sortGroups(groups: GapGroupWithTrend[], sort: SortKey): GapGroupWithTrend[] {
  return [...groups].sort(compareGroups(sort));
}

export interface PeriodTotals {
  gaps: number;
  occurrences: number;
  refusals: number;
  downvotes: number;
  weak: number;
  unsupported: number;
}

export function periodTotals(groups: GapGroup[]): PeriodTotals {
  const totals: PeriodTotals = {
    gaps: groups.length,
    occurrences: 0,
    refusals: 0,
    downvotes: 0,
    weak: 0,
    unsupported: 0,
  };
  for (const g of groups) {
    totals.occurrences += g.count;
    totals.refusals += g.refusals;
    totals.downvotes += g.downvotes;
    totals.weak += g.weak;
    totals.unsupported += g.unsupported;
  }
  return totals;
}

/**
 * The key evidence is counted under. A page is its document; a tool result
 * is the tool, because every call has its own id and the page wants "the
 * answers relied on this tool", not one entry per call.
 */
function evidenceKey(c: Citation): string {
  return c.kind === ACTION_CITATION_KIND ? `action:${c.title}` : c.documentId;
}

function tally(into: Map<string, GapEvidence>, citations: Citation[]): void {
  const seen = new Set<string>();
  for (const c of uniqueByDocument(citations)) {
    const key = evidenceKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = into.get(key);
    if (existing) existing.count += 1;
    else
      into.set(key, {
        documentId: key,
        title: c.title,
        url: c.url,
        kind: c.kind,
        count: 1,
      });
  }
}

function ranked(evidence: Map<string, GapEvidence>): GapEvidence[] {
  return [...evidence.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** The text fallback: the normalised question. */
export const keyByQuestion = (row: GapRow): string =>
  `key:${normalizeQuestion(row.question?.trim() || "(no user message)")}`;

/** The default: the cluster when the worker has assigned one, the text otherwise. */
export const keyByCluster = (row: GapRow): string =>
  row.gapClusterId ? `cluster:${row.gapClusterId}` : keyByQuestion(row);

/* ------------------------------------------------------------------------ */
/* Analysis requests (spec: gap-analysis-feedback)                            */
/* ------------------------------------------------------------------------ */

export { ANALYSIS_PENDING_TTL_MS, ANALYZE_ALL_CAP };

/** A stored error, by whether the budget or the model refused. */
export function classifyAnalysisFailure(error: string | null): AnalysisFailure | null {
  if (!error) return null;
  return { kind: error === GAP_ANALYSIS_BUDGET_ERROR ? "budget" : "other", message: error };
}

export function isAnalysisPending(
  requestedAt: Date | null,
  now: Date,
  ttlMs = ANALYSIS_PENDING_TTL_MS,
): boolean {
  if (requestedAt === null) return false;
  return now.getTime() - requestedAt.getTime() < ttlMs;
}

export interface AnalysisSummary {
  /** Open clusters with no analysis and no live request, in table order — what one click sends. */
  analyzableIds: string[];
  counts: AnalysisCounts;
}

/** What the callout needs, counted once over the groups in view. */
export function summarizeAnalysis(groups: GapGroup[]): AnalysisSummary {
  const analyzableIds: string[] = [];
  const counts: AnalysisCounts = {
    analyzable: 0,
    pending: 0,
    analyzed: 0,
    failed: 0,
    budgetFailed: 0,
    stale: 0,
  };
  for (const g of groups) {
    if (!g.clusterId) continue;
    if (g.analysisPending) counts.pending += 1;
    else if (g.analysisRequestedAt !== null) counts.stale += 1;
    if (g.analysis) counts.analyzed += 1;
    if (g.analysisFailure) {
      counts.failed += 1;
      if (g.analysisFailure.kind === "budget") counts.budgetFailed += 1;
    }
    if (g.status === "open" && !g.analysis && !g.analysisPending) analyzableIds.push(g.clusterId);
  }
  counts.analyzable = analyzableIds.length;
  return { analyzableIds, counts };
}

/**
 * Groups by key (the normalised question unless told otherwise); most
 * frequent first, then most recent. `sortGroups` re-orders for the page.
 * `now` decides which analysis requests still count as pending.
 */
export function groupGaps(
  rows: GapRow[],
  cfg: GapsConfig = GAPS_DEFAULTS,
  keyOf: (row: GapRow) => string = keyByCluster,
  now: Date = new Date(),
): GapGroup[] {
  const groups = new Map<
    string,
    GapGroup & {
      foundMap: Map<string, GapEvidence>;
      citedMap: Map<string, GapEvidence>;
      termMap: Map<string, number>;
    }
  >();

  // Oldest first so "question as first typed" and firstSeen mean what they say.
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of ordered) {
    const question = row.question?.trim() || "(no user message)";
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) {
      const pending = isAnalysisPending(row.cluster?.analysisRequestedAt ?? null, now);
      group = {
        key,
        question: row.cluster?.label ?? question,
        clusterId: row.gapClusterId,
        status: row.cluster?.status ?? "open",
        variants: [],
        reopenedAt: row.cluster?.reopenedAt ?? null,
        analysis: row.cluster?.analysis ?? null,
        analysisRequestedAt: row.cluster?.analysisRequestedAt ?? null,
        analysisPending: pending,
        analysisError: row.cluster?.analysisError ?? null,
        analysisFailure: pending
          ? null
          : classifyAnalysisFailure(row.cluster?.analysisError ?? null),
        correctionDocumentId: row.cluster?.correctionDocumentId ?? null,
        count: 0,
        refusals: 0,
        downvotes: 0,
        weak: 0,
        unsupported: 0,
        unsupportedTerms: [],
        unsourced: 0,
        firstSeen: row.createdAt,
        lastSeen: row.createdAt,
        latestConversationId: row.conversationId,
        latestMessageId: row.messageId,
        reasons: {},
        comments: [],
        found: [],
        cited: [],
        occurrences: [],
        foundMap: new Map(),
        citedMap: new Map(),
        termMap: new Map(),
      };
      groups.set(key, group);
    }
    group.count += 1;
    group.occurrences.push(row.createdAt);
    if (!group.variants.includes(question)) group.variants.push(question);
    const cls = classifyAnswer(row, cfg);
    if (row.refused) group.refusals += 1;
    if (row.feedback === "down") group.downvotes += 1;
    if (cls.kinds.includes("weak_answer")) group.weak += 1;
    if (cls.kinds.includes("unsupported_terms")) {
      group.unsupported += 1;
      // Once per answer per name: an answer that bolds a name twice used it once.
      for (const term of new Set(row.unsupportedTerms ?? [])) {
        group.termMap.set(term, (group.termMap.get(term) ?? 0) + 1);
      }
    }
    if (cls.unsourced) group.unsourced += 1;
    if (row.createdAt >= group.lastSeen) {
      group.lastSeen = row.createdAt;
      group.latestConversationId = row.conversationId;
      group.latestMessageId = row.messageId;
    }
    if (row.feedbackReason) {
      group.reasons[row.feedbackReason] = (group.reasons[row.feedbackReason] ?? 0) + 1;
    }
    if (row.feedbackComment) group.comments.push(row.feedbackComment);

    // A refusal stores what retrieval found; a downvoted answer stores what
    // it cited. Same column, different meaning — kept apart on purpose.
    const citations = parseCitations(row.citations) ?? [];
    if (row.refused) tally(group.foundMap, citations);
    else tally(group.citedMap, citations);
  }

  return [...groups.values()]
    .map(({ foundMap, citedMap, termMap, ...group }) => ({
      ...group,
      found: ranked(foundMap),
      cited: ranked(citedMap),
      unsupportedTerms: [...termMap.entries()]
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)),
    }))
    .sort((a, b) => b.count - a.count || b.lastSeen.getTime() - a.lastSeen.getTime());
}
