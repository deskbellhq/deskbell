import { cn } from "@deskbell/ui/lib/utils";
import { ThumbsDown, Undo2, UserRound } from "lucide-react";

import type { ThreadStatus } from "@/lib/thread-status";

/**
 * The two marks an inbox row carries (spec: attention-inbox). The status
 * disc is the only coloured thing on the row: filled in --certain or
 * --uncertain, the marks the badge and the chart use, hollow for a thread
 * nothing has answered yet. The attention glyphs are monochrome and share
 * one slot: a thumbs-down, a question that asked for a person, a question
 * that pushed back — the three reasons a person should read the thread.
 */
export const STATUS_TITLE: Record<ThreadStatus, string> = {
  certain: "Certain — every answer grounded above the weak floor",
  uncertain: "Uncertain — an answer refused, weakly grounded, or named something not in the docs",
  unanswered: "Unanswered — no reply yet",
};

export function StatusDisc({ status, className }: { status: ThreadStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={OUTCOME_WORD[status]}
      title={STATUS_TITLE[status]}
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "certain" && "bg-certain",
        status === "uncertain" && "bg-uncertain",
        status === "unanswered" && "border border-uncertain",
        className,
      )}
    />
  );
}

const OUTCOME_WORD: Record<ThreadStatus, string> = {
  certain: "Certain",
  uncertain: "Uncertain",
  unanswered: "Unanswered",
};

export const ATTENTION_LABELS = {
  downvoted: "Marked an answer down",
  wantsHuman: "Asked for a person",
  pushback: "Pushed back on an answer",
} as const;

export function AttentionGlyphs({
  downvoted,
  wantsHuman,
  pushback,
  className,
}: {
  downvoted: boolean;
  wantsHuman: boolean;
  pushback: boolean;
  className?: string;
}) {
  if (!downvoted && !wantsHuman && !pushback) return null;
  const glyph = "size-3 text-muted-foreground";
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {wantsHuman ? (
        <span title={ATTENTION_LABELS.wantsHuman}>
          <UserRound className={glyph} aria-label={ATTENTION_LABELS.wantsHuman} />
        </span>
      ) : null}
      {pushback ? (
        <span title={ATTENTION_LABELS.pushback}>
          <Undo2 className={glyph} aria-label={ATTENTION_LABELS.pushback} />
        </span>
      ) : null}
      {downvoted ? (
        <span title={ATTENTION_LABELS.downvoted}>
          <ThumbsDown className={glyph} aria-label={ATTENTION_LABELS.downvoted} />
        </span>
      ) : null}
    </span>
  );
}
