import { cn } from "@deskbell/ui/lib/utils";
import { ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * The one drawing of a visitor's vote, shared by the Overview table and the
 * thread page so a thumbs-up is the same green and a thumbs-down the same
 * red everywhere (spec: conversations-inbox-polish). Null renders nothing;
 * the caller decides what an absent vote looks like in its own layout.
 */
export function FeedbackGlyph({
  feedback,
  className,
}: {
  feedback: "up" | "down" | null | undefined;
  className?: string;
}) {
  if (feedback === "up") {
    return (
      <ThumbsUp
        aria-label="Marked helpful"
        className={cn("text-green-600 dark:text-green-400", className)}
      />
    );
  }
  if (feedback === "down") {
    return <ThumbsDown aria-label="Marked down" className={cn("text-destructive/80", className)} />;
  }
  return null;
}
