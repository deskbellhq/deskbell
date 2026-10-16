import { Plug } from "lucide-react";
import type { ReactNode } from "react";

import { DOCS_ACTIONS_URL } from "@/lib/links";

/**
 * The page before the first server (spec: actions-settings-ui): what
 * attaching one makes possible and the one button that does it. Members
 * without the admin role see the same panel without the button.
 */
export function EmptyState({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-14 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Plug className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-base font-medium">No servers attached</h2>
        <p className="text-sm text-muted-foreground">
          Attach an MCP server and the widget can look up a visitor's order, check their plan or
          open a ticket for them. You decide, tool by tool, what runs on its own and what the
          visitor confirms first.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {action}
        <a
          href={DOCS_ACTIONS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          How it works
        </a>
      </div>
    </div>
  );
}
