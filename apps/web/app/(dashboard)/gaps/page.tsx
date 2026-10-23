import { embeddingModelId } from "@deskbell/core/models";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import {
  CircleCheck,
  CircleSlash,
  FileText,
  Loader2,
  PanelRight,
  PenLine,
  Plug,
  RotateCcw,
  ThumbsDown,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { saveCorrection } from "@/app/(dashboard)/sources/answers/actions";
import { AnalysisCallout } from "@/components/analysis-callout";
import { AutoRefresh } from "@/components/auto-refresh";
import { GapDetail } from "@/components/gap-detail";
import { GapRowActions } from "@/components/gap-row-actions";
import { GapsToolbar } from "@/components/gaps-toolbar";
import { PageHeader } from "@/components/page-header";
import { ReclusterButton } from "@/components/recluster-button";
import { SiteHeader } from "@/components/site-header";
import { getPublicBaseUrl } from "@/lib/base-url";
import {
  ACTION_LABEL,
  isAction,
  isWrittenAnswer,
  WRITTEN_ANSWER_LABEL,
} from "@/lib/citation-label";
import { loadCorrectionsByIds } from "@/lib/corrections-query";
import { getDb } from "@/lib/db";
import { failureCopy } from "@/lib/gap-analysis-ui";
import { REASON_LABELS, taskBriefFor } from "@/lib/gap-task";
import {
  ANALYZE_ALL_CAP,
  attachTrend,
  countByStatus,
  filterByStatus,
  type GapEvidence,
  type GapGroupWithTrend,
  gapsHref,
  groupGaps,
  keyByCluster,
  type Period,
  type PeriodTotals,
  periodTotals,
  resolvePeriod,
  resolveSort,
  resolveStatus,
  type StatusCounts,
  type StatusKey,
  sortGroups,
  summarizeAnalysis,
  type Trend,
} from "@/lib/gaps";
import { evalCaseSkeleton } from "@/lib/gaps-export";
import { loadGapRows } from "@/lib/gaps-query";
import { readGapsConfig } from "@/lib/gaps-signal";
import { relativeTime } from "@/lib/inbox";
import { getDefaultProject } from "@/lib/org";
import { unsupportedTitle } from "@/lib/refusal-label";
import {
  analyzeCluster,
  analyzeOpenClusters,
  draftAnswer,
  reclusterProject,
  reopenCluster,
  resolveCluster,
} from "./actions";

export const dynamic = "force-dynamic";

const EVIDENCE_SHOWN = 3;

/** Under the question: the analysis, the request in flight, or the stored failure. */
function AnalysisLine({ group: g }: { group: GapGroupWithTrend }) {
  const failure = g.analysisFailure ? failureCopy(g.analysisFailure.kind) : null;
  return (
    <>
      {g.analysis ? (
        <p className="text-xs">
          <span className="font-medium">{g.analysis.title}.</span>{" "}
          <span className="text-muted-foreground">{g.analysis.recommendation}</span>
        </p>
      ) : null}
      {g.analysisPending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          />
          {g.analysis ? "Re-analyzing…" : "Analyzing…"}
        </p>
      ) : null}
      {failure && g.analysisFailure ? (
        <p
          className="flex items-center gap-1.5 text-xs text-destructive/80"
          title={g.analysisFailure.message}
        >
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {failure.short} — open Details to retry
        </p>
      ) : null}
    </>
  );
}

function Evidence({ label, items }: { label: string; items: GapEvidence[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, EVIDENCE_SHOWN);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {shown.map((e) => {
        const written = isWrittenAnswer(e);
        const action = isAction(e);
        const title = written
          ? `${WRITTEN_ANSWER_LABEL}: ${e.title}`
          : action
            ? `${ACTION_LABEL}: ${e.title}`
            : e.title;
        const Icon = written ? PenLine : action ? Plug : FileText;
        // Without a link the badge is the pill itself: an inner span would
        // put the icon outside the badge's sizing rule and wrap the text.
        return e.url ? (
          <Badge
            key={e.documentId}
            variant="outline"
            className="max-w-56 text-muted-foreground"
            asChild
          >
            <a href={e.url} rel="noopener noreferrer" target="_blank" title={title}>
              <Icon />
              <span className="truncate">{e.title}</span>
            </a>
          </Badge>
        ) : (
          <Badge
            key={e.documentId}
            variant="outline"
            className="max-w-56 text-muted-foreground"
            title={title}
          >
            <Icon />
            <span className="truncate">{e.title}</span>
          </Badge>
        );
      })}
      {items.length > shown.length ? (
        <span className="text-xs text-muted-foreground">+{items.length - shown.length}</span>
      ) : null}
    </div>
  );
}

const PERIOD_LABEL = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "all time",
} as const;

/**
 * The empty table, by view (spec: gaps-status-filter). The open view says
 * when the reason is that everything in the period is resolved, and links
 * there; the resolved view says so plainly; the combined view keeps the
 * original copy.
 */
function EmptyState({
  period,
  status,
  counts,
}: {
  period: Period;
  status: StatusKey;
  counts: StatusCounts;
}) {
  const span = period.key === "all" ? "" : ` in the last ${PERIOD_LABEL[period.key]}`;
  if (status === "resolved") return <>No resolved gaps{span || " yet"}.</>;
  if (status === "open" && counts.resolved > 0) {
    return (
      <>
        No open gaps{span} —{" "}
        <Link
          href={gapsHref("/gaps", { period: period.key, status: "resolved" })}
          className="underline underline-offset-4"
        >
          {counts.resolved} resolved
        </Link>
      </>
    );
  }
  return period.key === "all" ? (
    <>
      No gaps yet — every question so far was answered. Refusals and thumbs-down from the widget
      will show up here.
    </>
  ) : (
    <>No gaps{span}. Widen the period to see older ones.</>
  );
}

function TrendBadge({ trend, previous }: { trend: Trend | null; previous: number }) {
  if (trend === null || trend === "flat") return null;
  if (trend === "new") {
    return (
      <Badge variant="secondary" className="text-xs">
        New
      </Badge>
    );
  }
  const Icon = trend === "up" ? TrendingUp : TrendingDown;
  return (
    <Badge
      variant="outline"
      className={trend === "up" ? "text-destructive/80" : "text-muted-foreground"}
      title={`${previous} in the previous period`}
    >
      <Icon />
      {trend === "up" ? "Up" : "Down"}
    </Badge>
  );
}

function Delta({
  now,
  before,
  hasPrevious,
}: {
  now: number;
  before: number;
  hasPrevious: boolean;
}) {
  if (!hasPrevious) return null;
  const diff = now - before;
  const label = diff === 0 ? "no change" : diff > 0 ? `+${diff}` : String(diff);
  return (
    <span className="text-xs text-muted-foreground" title={`${before} in the previous period`}>
      {label} vs previous
    </span>
  );
}

function Totals({
  totals,
  previous,
  hasPrevious,
}: {
  totals: PeriodTotals;
  previous: PeriodTotals;
  hasPrevious: boolean;
}) {
  const cells: { label: string; now: number; before: number }[] = [
    { label: "Gaps", now: totals.gaps, before: previous.gaps },
    { label: "Refused", now: totals.refusals, before: previous.refusals },
    { label: "Marked down", now: totals.downvotes, before: previous.downvotes },
    { label: "Weak answers", now: totals.weak, before: previous.weak },
    { label: "Unsupported names", now: totals.unsupported, before: previous.unsupported },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-0.5 rounded-lg border px-4 py-3">
          <dt className="text-xs text-muted-foreground">{c.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{c.now}</dd>
          <Delta now={c.now} before={c.before} hasPrevious={hasPrevious} />
        </div>
      ))}
    </dl>
  );
}

export default async function GapsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    sort?: string | string[];
    status?: string | string[];
    gap?: string | string[];
    write?: string | string[];
  }>;
}) {
  const [project, params, baseUrl] = await Promise.all([
    getDefaultProject(),
    searchParams,
    getPublicBaseUrl(),
  ]);
  const db = getDb();
  const cfg = readGapsConfig();
  // One clock for the whole render: the window, the recency weights and the
  // relative times all agree on what "now" is.
  const now = new Date();
  const period = resolvePeriod(params.period, now);
  const sort = resolveSort(params.sort);
  const status = resolveStatus(params.status);
  // The drawer is URL state (spec: gap-drawer-url-state): which cluster, and
  // whether its form is open. Its rows are loaded by id over all time, so it
  // survives the period and status filters of the table beside it.
  const gapId = Array.isArray(params.gap) ? params.gap[0] : params.gap;
  const writing = (Array.isArray(params.write) ? params.write[0] : params.write) === "1";
  const view = { period: period.key, sort, status };
  // The task brief's context (spec: gap-task-brief): the table's rows carry
  // the window, the drawer's group spans all time and carries none.
  const taskContext = { projectName: project.name, baseUrl, now };

  // The window and the equal-length window before it, in parallel: the
  // second exists only to say what changed.
  const [rows, previousRows, detailRows] = await Promise.all([
    loadGapRows(db, project, { from: period.from, to: null }, cfg),
    period.previousFrom && period.from
      ? loadGapRows(db, project, { from: period.previousFrom, to: period.from }, cfg)
      : Promise.resolve([]),
    gapId
      ? loadGapRows(db, project, { from: null, to: null }, cfg, { clusterId: gapId })
      : Promise.resolve([]),
  ]);
  const current = groupGaps(rows, cfg, keyByCluster, now);
  const previous = groupGaps(previousRows, cfg, keyByCluster, now);
  // Trend on every cluster of the period, then the status filter, then the
  // order (spec: gaps-status-filter). Status is a property of the cluster,
  // so the previous window is filtered the same way and the deltas compare
  // like with like; the counts on the control come from the unfiltered set.
  const withTrend = attachTrend(current, previous, period, now);
  const visible = filterByStatus(withTrend, status);
  const groups: GapGroupWithTrend[] = sortGroups(visible, sort);
  const totals = periodTotals(visible);
  const previousTotals = periodTotals(filterByStatus(previous, status));
  const counts = countByStatus(withTrend);
  const hasPrevious = period.previousFrom !== null;
  const detailGroup = gapId ? (groupGaps(detailRows, cfg, keyByCluster, now)[0] ?? null) : null;
  const detail = detailGroup?.clusterId ? detailGroup : null;
  // The answers written for the clusters on screen (spec: corrections-source).
  const corrections = await loadCorrectionsByIds(
    db,
    project,
    [...groups, ...(detail ? [detail] : [])].flatMap((g) =>
      g.correctionDocumentId ? [g.correctionDocumentId] : [],
    ),
  );

  // Clustering state (spec: gap-clusters): rows the worker has not reached
  // yet, and clusters embedded with a model other than the configured one.
  const unassigned = rows.filter((r) => r.gapClusterId === null).length;
  // Analysis state (spec: gap-analysis-feedback): what one click would send,
  // what is still being written, what came back and what failed.
  const analysis = summarizeAnalysis(groups);
  const configuredModel = embeddingModelId();
  const staleModels = [
    ...new Set(
      rows
        .map((r) => r.cluster?.embeddingModel)
        .filter((m): m is string => typeof m === "string" && m !== configuredModel),
    ),
  ];

  return (
    <>
      <SiteHeader title="Gaps" />
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          title="Gaps"
          description="Questions your content could not answer — refused for lack of grounding, answered and marked down, answered from a weak match, or answered with a name the documentation does not contain. Each is a page to write or fix: copy one as a prompt for your coding agent, or as an eval case to measure the fix."
          actions={<GapsToolbar period={period.key} sort={sort} status={status} counts={counts} />}
        />
        <Totals totals={totals} previous={previousTotals} hasPrevious={hasPrevious} />
        {/* Always mounted, keyed by period: it remembers the click it is reporting on. */}
        <AnalysisCallout
          key={period.key}
          analyzableIds={analysis.analyzableIds}
          counts={analysis.counts}
          cap={ANALYZE_ALL_CAP}
          action={analyzeOpenClusters}
        />
        {unassigned > 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            Grouping {unassigned} {unassigned === 1 ? "question" : "questions"} by meaning… the
            worker assigns each to a cluster; until then they are grouped by exact wording.
          </p>
        ) : null}
        {analysis.counts.pending > 0 || unassigned > 0 ? <AutoRefresh intervalMs={5000} /> : null}
        {staleModels.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <span>
              Some clusters were built with <code>{staleModels.join(", ")}</code>, but the
              configured embedding model is <code>{configuredModel}</code>. Similarities across
              models do not compare; rebuild the clusters.
            </span>
            <ReclusterButton action={reclusterProject} />
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead className="text-right">Times</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Last asked</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    <EmptyState period={period} status={status} counts={counts} />
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((g) => {
                  const reasons = Object.entries(g.reasons)
                    .map(([r, n]) => `${REASON_LABELS[r] ?? r}${n > 1 ? ` ×${n}` : ""}`)
                    .join(", ");
                  const correction = g.correctionDocumentId
                    ? (corrections.get(g.correctionDocumentId) ?? null)
                    : null;
                  return (
                    <TableRow key={g.key} id={g.clusterId ?? undefined} className="align-top">
                      <TableCell className="max-w-xl whitespace-normal">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/conversations/${g.latestConversationId}`}
                              className="font-medium hover:underline underline-offset-4"
                            >
                              {g.question}
                            </Link>
                            <TrendBadge trend={g.trend} previous={g.previousCount} />
                            {g.status === "resolved" && g.correctionDocumentId ? (
                              <Badge
                                variant="outline"
                                className="text-muted-foreground"
                                title="Resolved by a written answer"
                              >
                                <PenLine />
                                Answered
                              </Badge>
                            ) : g.status === "resolved" ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                <CircleCheck />
                                Resolved
                              </Badge>
                            ) : null}
                            {g.reopenedAt && period.from && g.reopenedAt >= period.from ? (
                              <Badge variant="outline" className="text-destructive/80">
                                <RotateCcw />
                                Recurring
                              </Badge>
                            ) : null}
                          </div>
                          <AnalysisLine group={g} />
                          {g.variants.length > 1 ? (
                            <p className="text-xs text-muted-foreground">
                              {g.variants.length} phrasings, e.g.{" "}
                              {g.variants
                                .filter((v) => v !== g.question)
                                .slice(0, 2)
                                .map((v) => `“${v}”`)
                                .join(", ")}
                            </p>
                          ) : null}
                          {reasons || g.comments.length > 0 ? (
                            <p className="text-xs text-destructive/80">
                              {[reasons, ...g.comments.slice(0, 2).map((c) => `“${c}”`)]
                                .filter(Boolean)
                                .join(" — ")}
                            </p>
                          ) : null}
                          <Evidence label="Found:" items={g.found} />
                          <Evidence label="Cited:" items={g.cited} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.count}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {g.refusals > 0 ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              <CircleSlash />
                              {g.refusals === g.count ? "Refused" : `Refused ${g.refusals}`}
                            </Badge>
                          ) : null}
                          {g.downvotes > 0 ? (
                            <Badge variant="outline" className="text-destructive/80">
                              <ThumbsDown />
                              {g.downvotes === g.count
                                ? "Marked down"
                                : `Marked down ${g.downvotes}`}
                            </Badge>
                          ) : null}
                          {g.unsupported > 0 ? (
                            <Badge
                              variant="outline"
                              className="text-amber-700 dark:text-amber-400"
                              title={unsupportedTitle(
                                g.unsupportedTerms.slice(0, 5).map((t) => t.term),
                              )}
                            >
                              <TriangleAlert />
                              {g.unsupported === g.count
                                ? "Unsupported name"
                                : `Unsupported name ${g.unsupported}`}
                            </Badge>
                          ) : null}
                          {g.weak > 0 ? (
                            <Badge
                              variant="outline"
                              className="text-amber-700 dark:text-amber-400"
                              title="Answered from a low-scoring match"
                            >
                              <TriangleAlert />
                              {g.weak === g.count ? "Weak" : `Weak ${g.weak}`}
                            </Badge>
                          ) : null}
                          {g.unsourced > 0 ? (
                            <span
                              className="self-center text-xs text-muted-foreground"
                              title="The model named no source, so every retrieved passage was cited"
                            >
                              cited everything{g.unsourced === g.count ? "" : ` ×${g.unsourced}`}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {relativeTime(g.lastSeen)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {g.clusterId ? (
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={gapsHref("/gaps", { ...view, gap: g.clusterId })}
                                scroll={false}
                              >
                                <PanelRight />
                                Details
                              </Link>
                            </Button>
                          ) : (
                            // A plain button: a Link inside a disabled Button
                            // asChild still navigates.
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              title="Details open once the worker has grouped this question"
                            >
                              <PanelRight />
                              Details
                            </Button>
                          )}
                          <GapRowActions
                            task={taskBriefFor(g, { ...taskContext, period })}
                            evalCase={evalCaseSkeleton(g)}
                            clusterId={g.clusterId}
                            status={g.status}
                            resolve={resolveCluster}
                            reopen={reopenCluster}
                            hasAnswer={correction !== null}
                            writeHref={
                              g.clusterId
                                ? gapsHref("/gaps", { ...view, gap: g.clusterId, write: true })
                                : null
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {detail?.clusterId ? (
          // One drawer for the page, keyed by cluster: it is not inside a
          // row, so a row leaving the view (resolved, answered, filtered)
          // does not take the drawer with it.
          <GapDetail
            key={detail.clusterId}
            gap={{
              question: detail.question,
              clusterId: detail.clusterId,
              status: detail.status,
              count: detail.count,
              variants: detail.variants,
              reopenedAt: detail.reopenedAt?.toISOString() ?? null,
              found: detail.found,
              cited: detail.cited,
              unsupportedTerms: detail.unsupportedTerms,
              latestConversationId: detail.latestConversationId,
              analysis: detail.analysis
                ? {
                    title: detail.analysis.title,
                    finding: detail.analysis.finding,
                    recommendation: detail.analysis.recommendation,
                    suggestedFacts: detail.analysis.suggestedFacts,
                    model: detail.analysis.model,
                    analyzedAt: detail.analysis.analyzedAt,
                  }
                : null,
              analysisPending: detail.analysisPending,
              analysisFailure: detail.analysisFailure,
              correction: detail.correctionDocumentId
                ? (corrections.get(detail.correctionDocumentId) ?? null)
                : null,
              evalCase: evalCaseSkeleton(detail),
              task: taskBriefFor(detail, taskContext),
            }}
            hrefs={{
              close: gapsHref("/gaps", view),
              open: gapsHref("/gaps", { ...view, gap: detail.clusterId }),
              write: gapsHref("/gaps", { ...view, gap: detail.clusterId, write: true }),
            }}
            writing={writing}
            analyze={analyzeCluster}
            resolve={resolveCluster}
            reopen={reopenCluster}
            saveCorrection={saveCorrection}
            draftAnswer={draftAnswer}
          />
        ) : null}
      </div>
    </>
  );
}
