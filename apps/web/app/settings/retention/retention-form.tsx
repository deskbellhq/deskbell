"use client";

import { CONVERSATION_RETENTION_MAX_DAYS, CONVERSATION_RETENTION_PRESETS } from "@deskbell/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deskbell/ui/components/alert-dialog";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { relativeTime } from "@/lib/inbox";

import { countPastRetention, saveConversationRetention } from "./actions";

const CONTROL_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function presetLabel(days: number): string {
  return days === 0 ? "Keep forever" : `${days} days`;
}

/**
 * The retention form (spec: conversation-retention). A native select, so the
 * value is a form field and a browser test can drive it; Custom reveals a
 * number. The sentence under it names how many conversations the chosen
 * window would remove right now — presets from counts the page computed,
 * a custom number from the server. Saving a window that removes something
 * goes through a confirmation that names the count; anything else saves.
 */
export function RetentionForm({
  days,
  counts,
  canEdit,
  lastRun,
}: {
  days: number;
  counts: Record<number, number>;
  canEdit: boolean;
  lastRun: { at: string; removed: number } | null;
}) {
  const [state, action, pending] = useActionState(saveConversationRetention, undefined);
  const presets = CONVERSATION_RETENTION_PRESETS as readonly number[];
  const isPreset = presets.includes(days);
  const [choice, setChoice] = useState<string>(isPreset ? String(days) : "custom");
  const [custom, setCustom] = useState<string>(isPreset ? "" : String(days));
  const [customCount, setCustomCount] = useState<number | null>(
    isPreset ? null : (counts[days] ?? null),
  );
  const [counting, startCounting] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const selected = choice === "custom" ? Number.parseInt(custom, 10) : Number(choice);
  const validCustom =
    choice !== "custom" ||
    (Number.isInteger(selected) && selected >= 1 && selected <= CONVERSATION_RETENTION_MAX_DAYS);
  const count = choice === "custom" ? customCount : (counts[selected] ?? 0);

  // A custom number asks the server once it settles; presets never do.
  useEffect(() => {
    if (choice !== "custom" || !validCustom) {
      setCustomCount(null);
      return;
    }
    const value = selected;
    const handle = setTimeout(() => {
      startCounting(async () => {
        setCustomCount(await countPastRetention(value));
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [choice, selected, validCustom]);

  const submit = () => formRef.current?.requestSubmit();
  const onSave = () => {
    if (selected > 0 && (count ?? 0) > 0) setConfirming(true);
    else submit();
  };

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="days">Keep conversations for</FieldLabel>
            <FieldDescription>
              Counted from a conversation&apos;s last message. A visitor who returns to a thread
              keeps it.
            </FieldDescription>
          </FieldContent>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="days"
              name="days"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={!canEdit}
              className={`${CONTROL_CLASS} max-w-48`}
            >
              {presets.map((p) => (
                <option key={p} value={String(p)}>
                  {presetLabel(p)}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {choice === "custom" ? (
              <div className="flex items-center gap-2">
                <Input
                  id="customDays"
                  name="customDays"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={CONVERSATION_RETENTION_MAX_DAYS}
                  step={1}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  disabled={!canEdit}
                  aria-label="Custom number of days"
                  className="w-28 font-mono"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {selected === 0
              ? "Nothing is removed."
              : !validCustom
                ? `Enter a whole number between 1 and ${CONVERSATION_RETENTION_MAX_DAYS}.`
                : count === null || counting
                  ? "Counting…"
                  : count === 0
                    ? "Nothing is older than that right now."
                    : `${count.toLocaleString("en-US")} ${count === 1 ? "conversation is" : "conversations are"} older than ${selected} days and will be removed by the hourly job.`}
          </p>
        </Field>
      </FieldGroup>

      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved.{" "}
          {state.days
            ? `Conversations older than ${state.days} days are removed by the hourly job, starting now.`
            : "Conversations are kept."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canEdit ? (
          <Button type="button" onClick={onSave} disabled={pending || !validCustom || counting}>
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only admins can change retention.</p>
        )}
        <p className="text-xs text-muted-foreground">
          {days === 0
            ? "The job runs hourly once a window is set."
            : lastRun
              ? `Runs hourly. Last run ${relativeTime(lastRun.at)} ago, ${lastRun.removed.toLocaleString("en-US")} removed.`
              : "Runs hourly. Has not run yet."}
        </p>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {(count ?? 0).toLocaleString("en-US")}{" "}
              {count === 1 ? "conversation" : "conversations"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every conversation older than {selected} days goes, with its messages, citations,
              feedback and tool calls. This cannot be undone, and the window keeps applying every
              hour from now on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                submit();
              }}
            >
              Remove and keep {selected} days
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
