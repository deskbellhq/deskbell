"use client";

import { Alert, AlertDescription, AlertTitle } from "@deskbell/ui/components/alert";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@deskbell/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import { Separator } from "@deskbell/ui/components/separator";
import { useIsMobile } from "@deskbell/ui/hooks/use-mobile";
import {
  Check,
  CircleCheck,
  CircleSlash,
  ClipboardList,
  Copy,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenLine,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, useTransition } from "react";

import { isWrittenAnswer, WRITTEN_ANSWER_LABEL } from "@/lib/citation-label";
import { type AnalysisFailure, failureCopy } from "@/lib/gap-analysis-ui";
import { copyLabel, useCopy } from "@/lib/use-copy";

import {
  CorrectionForm,
  type DraftAnswerAction,
  type SaveCorrectionAction,
} from "./correction-form";

/**
 * The cluster's drawer (spec: gap-drawer-url-state, gap-analysis): its
 * answer, analysis, phrasings and evidence, with the actions in a sticky
 * footer. It is open because the URL says so — `?gap=<id>` — and closing
 * it is a navigation, so a view is a link and browser back closes it.
 * Everything the analyst wrote is rendered as text — it read visitor-typed
 * questions and site content, and nothing from either may become markup.
 */
export interface GapDetailData {
  question: string;
  clusterId: string;
  status: "open" | "resolved";
  count: number;
  variants: string[];
  /** The cluster reopened after being resolved — the fix did not hold. */
  reopenedAt: string | null;
  found: Array<{ documentId: string; title: string; url?: string; kind?: string; count: number }>;
  cited: Array<{ documentId: string; title: string; url?: string; kind?: string; count: number }>;
  /** Names the answers used that the documentation does not contain (spec: answer-verification). */
  unsupportedTerms: Array<{ term: string; count: number }>;
  latestConversationId: string;
  analysis: {
    title: string;
    finding: string;
    recommendation: string;
    suggestedFacts: string[];
    model: string;
    analyzedAt: string;
  } | null;
  analysisPending: boolean;
  /** The last request's stored error, classified; null while one is in flight. */
  analysisFailure: AnalysisFailure | null;
  /** The answer written for this cluster (spec: corrections-source); null until there is one. */
  correction: { documentId: string; answer: string } | null;
  /** The eval-case skeleton, ready for the clipboard. */
  evalCase: string;
  /** The cluster as a task brief (spec: gap-task-brief), ready for the clipboard. */
  task: string;
}

export interface GapDetailHrefs {
  /** The same view without the drawer. */
  close: string;
  /** The drawer open, not writing. */
  open: string;
  /** The drawer open in writing mode. */
  write: string;
}

function DocList({ label, items }: { label: string; items: GapDetailData["found"] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="flex flex-col gap-1">
        {items.map((e) => (
          <li key={e.documentId} className="flex items-center gap-2 text-sm">
            {isWrittenAnswer(e) ? (
              <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {e.url ? (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:underline underline-offset-4"
              >
                {e.title}
              </a>
            ) : (
              <span className="truncate">{e.title}</span>
            )}
            {isWrittenAnswer(e) ? (
              <span className="shrink-0 text-xs text-muted-foreground">{WRITTEN_ANSWER_LABEL}</span>
            ) : null}
            {e.count > 1 ? <span className="text-xs text-muted-foreground">×{e.count}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusChip({ gap }: { gap: GapDetailData }) {
  if (gap.status === "resolved" && gap.correction) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
        title="Resolved by a written answer"
      >
        <PenLine />
        Answered
      </Badge>
    );
  }
  if (gap.status === "resolved") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleCheck />
        Resolved
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <CircleSlash />
      Open
    </Badge>
  );
}

export function GapDetail({
  gap,
  hrefs,
  writing: initialWriting,
  analyze,
  resolve,
  reopen,
  saveCorrection,
  draftAnswer,
}: {
  gap: GapDetailData;
  hrefs: GapDetailHrefs;
  /** Opened straight into the form (`&write=1`). */
  writing: boolean;
  analyze: (clusterId: string) => Promise<void>;
  resolve: (clusterId: string) => Promise<void>;
  reopen: (clusterId: string) => Promise<void>;
  saveCorrection: SaveCorrectionAction;
  draftAnswer: DraftAnswerAction;
}) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const formId = useId();
  // Local first, URL second: the drawer's close animation needs the flip
  // before the navigation removes this component from the page.
  const [open, setOpen] = useState(true);
  const [writing, setWriting] = useState(initialWriting);
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const evalCopy = useCopy();
  const taskCopy = useCopy();
  const [pending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const busy = pending || gap.analysisPending;
  const setStatus = gap.status === "resolved" ? reopen : resolve;

  const close = useCallback(() => {
    setOpen(false);
    router.replace(hrefs.close, { scroll: false });
  }, [router, hrefs.close]);
  const startWriting = useCallback(() => {
    setSaved(false);
    setWriting(true);
    router.replace(hrefs.write, { scroll: false });
  }, [router, hrefs.write]);
  const stopWriting = useCallback(() => {
    setWriting(false);
    // A reload must not reopen the form.
    router.replace(hrefs.open, { scroll: false });
  }, [router, hrefs.open]);
  const onSaved = useCallback(() => {
    setSaved(true);
    stopWriting();
  }, [stopWriting]);

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DrawerContent>
        <DrawerHeader className="gap-1.5 pr-12">
          <DrawerTitle className="text-left">{gap.question}</DrawerTitle>
          <DrawerDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
              <StatusChip gap={gap} />
              <span>
                Asked {gap.count} {gap.count === 1 ? "time" : "times"}
              </span>
              {gap.variants.length > 1 ? <span>· {gap.variants.length} phrasings</span> : null}
              {gap.reopenedAt ? (
                <span className="text-destructive/80">
                  · Recurring since{" "}
                  {new Date(gap.reopenedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null}
            </div>
          </DrawerDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 right-3 text-muted-foreground"
            aria-label="Close"
            onClick={close}
          >
            <X />
          </Button>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm">
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <PenLine className="size-3.5" />
              Answer
            </p>
            {writing ? (
              <CorrectionForm
                id={formId}
                actions="external"
                autoFocus
                action={saveCorrection}
                documentId={gap.correction?.documentId}
                clusterId={gap.clusterId}
                defaultQuestion={gap.question}
                defaultAnswer={gap.correction?.answer}
                draft={draftAnswer}
                onSaved={onSaved}
                onPendingChange={setSavePending}
              />
            ) : gap.correction ? (
              <p className="whitespace-pre-wrap">{gap.correction.answer}</p>
            ) : (
              <p className="text-muted-foreground italic">
                No answer written yet. An answer is indexed like a page and cited when it matches
                the question; saving one marks this gap resolved.
              </p>
            )}
            {saved && !writing ? (
              <p role="status" className="text-xs text-muted-foreground">
                Saved. Indexing runs in the background.
              </p>
            ) : null}
          </div>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5" />
                Analysis
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-busy={busy}
                onClick={() => startTransition(() => analyze(gap.clusterId))}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                ) : null}
                {busy ? "Analyzing…" : gap.analysis ? "Re-analyze" : "Analyze"}
              </Button>
            </div>
            {gap.analysisFailure && !busy ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{failureCopy(gap.analysisFailure.kind).short}</AlertTitle>
                <AlertDescription>
                  <p>
                    {failureCopy(gap.analysisFailure.kind).advice ?? gap.analysisFailure.message}
                  </p>
                  {gap.analysisFailure.kind === "other" ? (
                    <p>{gap.analysis ? "Re-analyze" : "Analyze"} sends it again.</p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {gap.analysis ? (
              <div className="flex flex-col gap-3">
                <p className="font-medium">{gap.analysis.title}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{gap.analysis.finding}</p>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Recommendation</p>
                  <p className="whitespace-pre-wrap">{gap.analysis.recommendation}</p>
                </div>
                {gap.analysis.suggestedFacts.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Suggested marking criteria — draft, review before trusting a grade
                    </p>
                    <ul className="list-disc pl-5">
                      {gap.analysis.suggestedFacts.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-1 font-mono text-[10px]">
                    {gap.analysis.model}
                  </Badge>
                  {new Date(gap.analysis.analyzedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ) : busy ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2
                  aria-hidden="true"
                  className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                />
                The model is reading this cluster. This panel updates on its own.
              </p>
            ) : (
              <p className="text-muted-foreground italic">
                Not analyzed yet. Analysis asks the configured chat model what the content is
                missing and what to write; it counts against the daily token budget.
              </p>
            )}
            {/* The next thing to do with the recommendation: hand it on (spec: gap-task-brief). */}
            <div className="mt-1 flex flex-col items-start gap-1.5">
              <Button
                size="sm"
                variant="outline"
                // Wide enough for every label, so the button does not resize on copy.
                className="min-w-72"
                aria-live="polite"
                onClick={() => taskCopy.copy(gap.task)}
              >
                {taskCopy.state === "copied" ? <Check /> : <ClipboardList />}
                {copyLabel(taskCopy.state, "Copy prompt for your coding agent")}
              </Button>
              <p className="text-xs text-muted-foreground">
                Markdown with the questions, the pages found
                {gap.analysis ? ", the finding and the criteria" : ""}, and how to verify.
              </p>
            </div>
          </div>
          {gap.variants.length > 1 ? (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Phrasings</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {gap.variants.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
          {gap.found.length > 0 || gap.cited.length > 0 ? (
            <>
              <Separator />
              <DocList label="What retrieval found on refusals" items={gap.found} />
              <DocList label="What answers cited" items={gap.cited} />
            </>
          ) : null}
          {gap.unsupportedTerms.length > 0 ? (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Names the answers used that the documentation does not contain
                </p>
                <ul className="flex flex-col gap-1">
                  {gap.unsupportedTerms.map((t) => (
                    <li key={t.term} className="flex items-center gap-2 text-sm">
                      <TriangleAlert className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
                      <span className="truncate">{t.term}</span>
                      {t.count > 1 ? (
                        <span className="text-xs text-muted-foreground">×{t.count}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
          <Separator />
          <Link
            href={`/conversations/${gap.latestConversationId}`}
            className="text-muted-foreground hover:underline underline-offset-4"
          >
            Open latest conversation
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t p-4">
          {writing ? (
            <>
              <Button type="submit" form={formId} disabled={savePending} aria-busy={savePending}>
                {savePending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {savePending ? "Saving…" : gap.correction ? "Save changes" : "Save answer"}
              </Button>
              <Button type="button" variant="ghost" onClick={stopWriting} disabled={savePending}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={startWriting}>
                {gap.correction ? <Pencil /> : <PenLine />}
                {gap.correction ? "Edit answer" : "Write an answer"}
              </Button>
              <Button
                variant="outline"
                disabled={statusPending}
                onClick={() => startStatusTransition(() => setStatus(gap.clusterId))}
              >
                {gap.status === "resolved" ? <RotateCcw /> : <CircleCheck />}
                {gap.status === "resolved" ? "Reopen" : "Mark resolved"}
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto text-muted-foreground"
                aria-label="More"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={(event) => {
                  // Stay open long enough to show that it worked.
                  event.preventDefault();
                  evalCopy.copy(gap.evalCase);
                }}
              >
                {evalCopy.state === "copied" ? <Check /> : <Copy />}
                {copyLabel(evalCopy.state, "Copy as eval case")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/conversations/${gap.latestConversationId}`}>
                  Open latest conversation
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
