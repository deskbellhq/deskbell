import { Badge } from "@deskbell/ui/components/badge";
import { CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";

import type { ThreadStatus } from "@/lib/thread-status";

/**
 * The one badge for a thread's confidence (lib/thread-status.ts), rendered by
 * the Overview table and the thread page so the two cannot disagree on the
 * word or the icon. Every thread with a reply is answered; the badge says
 * whether the agent was sure — grounded above the weak floor and nothing
 * refused — or not. The two answered states are built the same way, a
 * filled disc with a card-coloured glyph, in the theme's --certain and
 * --uncertain; only unanswered is hollow, because nothing has happened yet.
 */
export function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  if (status === "certain") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <CheckCircle2 className="fill-certain stroke-card" />
        Certain
      </Badge>
    );
  }
  if (status === "unanswered") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <CircleDashed className="text-uncertain" />
        Unanswered
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      <CircleSlash className="fill-uncertain stroke-card" />
      Uncertain
    </Badge>
  );
}
