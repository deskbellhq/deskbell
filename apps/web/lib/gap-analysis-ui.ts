/**
 * The analysis callout's state (spec: gap-analysis-feedback): pure functions
 * from what the server counted and what the client remembers about its own
 * click, to the words and the control on screen. No React, no database, no
 * model, no imports — the whole state machine is unit-testable and the
 * client bundle carries nothing but strings.
 */

/** How many clusters one "Analyze N open" click may send to the model. */
export const ANALYZE_ALL_CAP = 20;

/**
 * A request the worker has not answered in this long is treated as lost —
 * the worker was down, or the job was dropped — so the row stops reading as
 * busy and the request can be sent again. One worker drains a full click of
 * twenty in under ten minutes even when every model call runs to its
 * thirty-second timeout, so fifteen never cuts a live run short.
 */
export const ANALYSIS_PENDING_TTL_MS = 15 * 60_000;

export type AnalysisFailureKind = "budget" | "other";

export interface AnalysisFailure {
  kind: AnalysisFailureKind;
  /** The stored error, verbatim; shown as text only. */
  message: string;
}

/** What the server counted over the clusters in view. */
export interface AnalysisCounts {
  /** Open, no analysis, no live request: what one click would send. */
  analyzable: number;
  /** Requested and unanswered, inside the TTL. */
  pending: number;
  /** Carrying a stored analysis. */
  analyzed: number;
  /** Carrying a stored error and no live request. */
  failed: number;
  /** The part of `failed` that was refused for budget. */
  budgetFailed: number;
  /** Requested, unanswered, past the TTL. */
  stale: number;
}

/**
 * What the client remembers from its own click. Progress and the outcome are
 * measured against it; it is the only state the server does not hold.
 */
export interface AnalysisRun {
  requested: number;
  pendingAtStart: number;
  analyzedAtStart: number;
  failedAtStart: number;
}

export type CalloutPhase = "idle" | "requesting" | "running" | "done";

export function calloutPhase(args: {
  /** The server action has not returned yet. */
  isPending: boolean;
  pending: number;
  run: AnalysisRun | null;
  /** The run finished and the outcome is still on screen. */
  doneFlash: boolean;
}): CalloutPhase {
  if (args.isPending) return "requesting";
  if (args.pending > 0) return "running";
  if (args.run && args.doneFlash) return "done";
  return "idle";
}

/**
 * Clamped both ways: the automatic rule can add pending clusters mid-run,
 * and a request the action skipped never counts down.
 */
export function analysisProgress(
  run: AnalysisRun,
  pending: number,
): { done: number; total: number } {
  const total = run.requested + run.pendingAtStart;
  const done = Math.min(total, Math.max(0, total - pending));
  return { done, total };
}

export function analysisOutcome(
  run: AnalysisRun,
  analyzed: number,
  failed: number,
): { ready: number; failed: number } {
  return {
    ready: Math.max(0, analyzed - run.analyzedAtStart),
    failed: Math.max(0, failed - run.failedAtStart),
  };
}

/** The short label and the advice for a stored failure, by kind. */
export function failureCopy(kind: AnalysisFailureKind): { short: string; advice: string | null } {
  return kind === "budget"
    ? {
        short: "Daily token budget reached",
        advice:
          "The budget resets at midnight UTC; try again after that, or raise it under Settings › Install.",
      }
    : { short: "Analysis failed", advice: null };
}

export type CalloutIcon = "sparkles" | "spinner" | "check" | "warning";

export interface CalloutView {
  /** Nothing to say and nothing to offer. */
  hidden: boolean;
  icon: CalloutIcon;
  title: string;
  detail: string;
  button: { label: string; busy: boolean } | null;
}

const count = (n: number, singular: string, plural = `${singular}s`): string =>
  `${n} ${n === 1 ? singular : plural}`;
const analyses = (n: number) => count(n, "analysis", "analyses");

export function analysisCalloutView(
  phase: CalloutPhase,
  counts: AnalysisCounts,
  run: AnalysisRun | null,
  opts: { cap?: number; ttlMs?: number } = {},
): CalloutView {
  const cap = opts.cap ?? ANALYZE_ALL_CAP;
  const ttlMinutes = Math.round((opts.ttlMs ?? ANALYSIS_PENDING_TTL_MS) / 60_000);

  if (phase === "requesting") {
    const n = run?.requested ?? 0;
    return {
      hidden: false,
      icon: "spinner",
      title: `Requesting analysis for ${count(n, "cluster")}…`,
      detail: n === 1 ? "Queuing it for the worker." : "Queuing them for the worker.",
      button: { label: "Analyzing…", busy: true },
    };
  }

  if (phase === "running") {
    const progress = run ? analysisProgress(run, counts.pending) : null;
    const total = progress?.total ?? counts.pending;
    const suffix = progress ? ` ${progress.done} of ${progress.total} done` : "";
    return {
      hidden: false,
      icon: "spinner",
      title: `Analyzing ${count(total, "cluster")}…${suffix}`,
      detail: "Each takes a few seconds. This updates on its own; you can keep working.",
      button: null,
    };
  }

  if (phase === "done" && run) {
    const outcome = analysisOutcome(run, counts.analyzed, counts.failed);
    if (outcome.ready === 0 && outcome.failed === 0) {
      return {
        hidden: false,
        icon: "check",
        title: "No analyses written",
        detail: "The request finished without new findings; open a row's Details to see its state.",
        button: null,
      };
    }
    const failedSuffix = outcome.failed > 0 ? ` · ${analyses(outcome.failed)} failed` : "";
    return {
      hidden: false,
      icon: outcome.ready > 0 ? "check" : "warning",
      title:
        outcome.ready > 0
          ? `${analyses(outcome.ready)} ready${failedSuffix}`
          : `${analyses(outcome.failed)} failed`,
      detail:
        outcome.ready > 0
          ? "Findings and recommendations are on the rows; open Details for the full text."
          : "Open a row's Details for the error and to retry.",
      button: null,
    };
  }

  // Idle: failures first, then the offer, then the worker warning.
  const { analyzable, failed, budgetFailed, stale } = counts;
  const hidden = analyzable === 0 && failed === 0 && stale === 0;
  const button =
    analyzable > 0 ? { label: `Analyze ${Math.min(analyzable, cap)} open`, busy: false } : null;
  const staleNote =
    stale > 0
      ? `${count(stale, "request")} ${stale === 1 ? "has" : "have"} waited over ${ttlMinutes} minutes with no answer — check that the worker is running.`
      : null;

  if (failed > 0) {
    const allBudget = budgetFailed === failed;
    const detail = allBudget
      ? "The budget resets at midnight UTC; analyze again after that, or raise it under Settings › Install."
      : "Open a row's Details for the error and to retry.";
    return {
      hidden,
      icon: "warning",
      title: `${analyses(failed)} failed${allBudget ? " — daily token budget reached" : ""}`,
      detail: staleNote ? `${detail} ${staleNote}` : detail,
      button,
    };
  }

  if (analyzable > 0) {
    const detail = `Analysis asks the chat model what the content is missing and what to write. It counts against the daily token budget; up to ${cap} per click.`;
    return {
      hidden,
      icon: "sparkles",
      title: `${count(analyzable, "open cluster")} ${analyzable === 1 ? "has" : "have"} no analysis yet`,
      detail: staleNote ? `${detail} ${staleNote}` : detail,
      button,
    };
  }

  return {
    hidden,
    icon: "warning",
    title: "Analysis is waiting on the worker",
    detail: staleNote ?? "",
    button: null,
  };
}
