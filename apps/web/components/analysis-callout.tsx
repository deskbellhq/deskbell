"use client";

import { Button } from "@deskbell/ui/components/button";
import { CircleCheck, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  type AnalysisCounts,
  type AnalysisRun,
  analysisCalloutView,
  type CalloutIcon,
  calloutPhase,
} from "@/lib/gap-analysis-ui";

/**
 * The bar above the gaps table that offers, runs and reports bulk analysis
 * (spec: gap-analysis-feedback). The server counts; this remembers one thing
 * the server cannot — what this click asked for — so it can say "4 of 13
 * done" and, at the end, "5 analyses ready". It stays mounted through every
 * phase: the page keys it by period, and never wraps it in a condition.
 */

/** How long the outcome stays on screen before the bar returns to its offer. */
const DONE_FLASH_MS = 8000;

const ICONS: Record<CalloutIcon, React.ReactNode> = {
  sparkles: <Sparkles className="size-4 text-muted-foreground" />,
  spinner: (
    <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
  ),
  check: <CircleCheck className="size-4 text-primary" />,
  warning: <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />,
};

export function AnalysisCallout({
  analyzableIds,
  counts,
  cap,
  action,
}: {
  /** Open clusters in view with no analysis, in table order; the click sends these. */
  analyzableIds: string[];
  counts: AnalysisCounts;
  cap: number;
  action: (clusterIds: string[]) => Promise<void>;
}) {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [doneFlash, setDoneFlash] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const finished = run !== null && !isPending && counts.pending === 0;
  useEffect(() => {
    if (!finished) return;
    setDoneFlash(true);
    const id = setTimeout(() => {
      setDoneFlash(false);
      setRun(null);
    }, DONE_FLASH_MS);
    return () => clearTimeout(id);
  }, [finished]);

  const phase = calloutPhase({ isPending, pending: counts.pending, run, doneFlash });
  const view = analysisCalloutView(phase, counts, run, { cap });
  if (view.hidden) return null;

  const ids = analyzableIds.slice(0, cap);
  const busy = view.button?.busy ?? false;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
      <span className="flex shrink-0" aria-hidden="true">
        {ICONS[view.icon]}
      </span>
      <div role="status" className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{view.title}</span>
        {view.detail ? <span className="text-xs text-muted-foreground">{view.detail}</span> : null}
        {requestError ? <span className="text-xs text-destructive">{requestError}</span> : null}
      </div>
      {view.button ? (
        <Button
          size="sm"
          className="shrink-0"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setRun({
              requested: ids.length,
              pendingAtStart: counts.pending,
              analyzedAtStart: counts.analyzed,
              failedAtStart: counts.failed,
            });
            setRequestError(null);
            startTransition(async () => {
              try {
                await action(ids);
              } catch {
                setRequestError("Could not request analysis. Try again.");
                setRun(null);
              }
            });
          }}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {view.button.label}
        </Button>
      ) : null}
    </div>
  );
}
