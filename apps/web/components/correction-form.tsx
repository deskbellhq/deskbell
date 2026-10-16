"use client";

import { Button } from "@deskbell/ui/components/button";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { Textarea } from "@deskbell/ui/components/textarea";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { useActionState, useCallback, useEffect, useId, useState, useTransition } from "react";

import type { CorrectionFormState } from "@/app/(dashboard)/sources/answers/actions";
import {
  blanksSummary,
  type DraftFailureReason,
  type DraftResult,
  draftFailureCopy,
} from "@/lib/answer-draft";
import { CORRECTION_ANSWER_MAX, CORRECTION_QUESTION_MAX } from "@/lib/corrections";

/**
 * What the analyst wrote about the gap, shown beside the textarea as the
 * thing to write from. Text only — it read visitor questions and site
 * content, and nothing from either becomes markup here.
 */
export interface CorrectionReference {
  finding: string;
  recommendation: string;
  suggestedFacts: string[];
}

export type SaveCorrectionAction = (
  prev: CorrectionFormState | undefined,
  formData: FormData,
) => Promise<CorrectionFormState>;

/** Drafts the answer from the cluster's own material (spec: answer-drafting). */
export type DraftAnswerAction = (clusterId: string) => Promise<DraftResult>;

export interface CorrectionFormProps {
  action: SaveCorrectionAction;
  /** The form's DOM id, so a submit button outside it can target it with `form=`. */
  id?: string;
  /**
   * Where the buttons are. "inline" renders Save, Cancel and the saved line
   * under the fields; "external" renders none of them, for a drawer whose
   * sticky footer owns the actions (spec: gap-drawer-url-state).
   */
  actions?: "inline" | "external";
  /** Focus the answer field on mount, when the form opens as its own step. */
  autoFocus?: boolean;
  /** A submit outside the form cannot read useFormStatus; this tells it. */
  onPendingChange?: (pending: boolean) => void;
  /** Editing this answer; absent when writing a new one. */
  documentId?: string;
  /** Writing for this cluster; saving resolves it. */
  clusterId?: string;
  defaultQuestion?: string;
  defaultAnswer?: string;
  reference?: CorrectionReference | null;
  /**
   * Offers "Draft with AI". Only passed where there is a cluster to read:
   * an answer written from scratch has no material to draft from.
   */
  draft?: DraftAnswerAction;
  onSaved?: () => void;
  onCancel?: () => void;
}

/**
 * One form for both doors (spec: corrections-source): the cluster's panel and
 * the management page. The question is one line; the answer is text. No
 * toasts — the state is on screen.
 */
export function CorrectionForm({
  action,
  id: formId,
  actions = "inline",
  autoFocus = false,
  onPendingChange,
  documentId,
  clusterId,
  defaultQuestion = "",
  defaultAnswer = "",
  reference = null,
  draft,
  onSaved,
  onCancel,
}: CorrectionFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const id = useId();
  // Controlled from here on, because a draft writes into it.
  const [answer, setAnswer] = useState(defaultAnswer);
  const [drafting, startDrafting] = useTransition();
  const [drafted, setDrafted] = useState<{ blanks: string[]; replaced: string } | null>(null);
  const [draftFailure, setDraftFailure] = useState<{
    reason: DraftFailureReason;
    message: string;
  } | null>(null);

  const runDraft = useCallback(() => {
    if (!draft || !clusterId) return;
    setDraftFailure(null);
    startDrafting(async () => {
      const result = await draft(clusterId);
      if (!result.ok) {
        setDraftFailure({ reason: result.reason, message: result.message });
        return;
      }
      // Whatever was there is kept, so a draft never destroys work.
      setDrafted({ blanks: result.blanks, replaced: answer });
      setAnswer(result.answer);
    });
  }, [draft, clusterId, answer]);

  const undoDraft = useCallback(() => {
    if (!drafted) return;
    setAnswer(drafted.replaced);
    setDrafted(null);
  }, [drafted]);
  const savedAt = state?.saved?.at;
  useEffect(() => {
    if (savedAt !== undefined) onSaved?.();
  }, [savedAt, onSaved]);
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-4">
      {documentId ? <input type="hidden" name="id" value={documentId} /> : null}
      {clusterId ? <input type="hidden" name="clusterId" value={clusterId} /> : null}
      <div className={reference ? "grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-question`}>Question</Label>
            <Input
              id={`${id}-question`}
              name="question"
              defaultValue={defaultQuestion}
              maxLength={CORRECTION_QUESTION_MAX}
              placeholder="How do I cancel my plan?"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`${id}-answer`}>Answer</Label>
              {draft && clusterId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={drafting || pending}
                  aria-busy={drafting}
                  onClick={runDraft}
                >
                  {drafting ? (
                    <Loader2
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <Sparkles aria-hidden="true" />
                  )}
                  {drafting ? "Drafting…" : drafted ? "Redraft" : "Draft with AI"}
                </Button>
              ) : null}
            </div>
            <Textarea
              id={`${id}-answer`}
              name="answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={CORRECTION_ANSWER_MAX}
              rows={8}
              placeholder="What the assistant should say. Plain text; blank lines separate paragraphs."
              required
              autoFocus={autoFocus}
            />
            {draftFailure ? (
              <p role="alert" className="text-xs text-destructive">
                {draftFailureCopy(draftFailure.reason).short}
                {draftFailureCopy(draftFailure.reason, draftFailure.message).advice
                  ? ` — ${draftFailureCopy(draftFailure.reason, draftFailure.message).advice}`
                  : ""}
              </p>
            ) : null}
            {drafted && !draftFailure ? (
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <p role="status">{blanksSummary(drafted.blanks)}</p>
                {drafted.blanks.length > 0 ? (
                  <ul className="list-disc pl-5">
                    {drafted.blanks.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={undoDraft}
                  className="flex w-fit items-center gap-1 underline underline-offset-4 hover:text-foreground"
                >
                  <Undo2 aria-hidden="true" className="size-3" />
                  Undo draft
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {reference ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">What the analysis found</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{reference.finding}</p>
            <p className="whitespace-pre-wrap">{reference.recommendation}</p>
            {reference.suggestedFacts.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">A correct answer says</p>
                <ul className="list-disc pl-5">
                  {reference.suggestedFacts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {actions === "inline" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {pending ? "Saving…" : documentId ? "Save changes" : "Save answer"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          {savedAt !== undefined && !pending ? (
            <span role="status" className="text-sm text-muted-foreground">
              Saved. Indexing runs in the background.
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
