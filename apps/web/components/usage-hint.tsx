"use client";

import { Badge } from "@deskbell/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@deskbell/ui/components/tooltip";
import { type ReactNode, useState } from "react";

/**
 * A label that explains itself on hover or focus (spec: usage-page): the
 * dotted underline is the only affordance, so a column head stays a column
 * head. Keyboard users reach it by tab; the content is the rule in one
 * sentence, never a restatement of the label.
 */
export function Hint({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-help font-inherit text-inherit underline decoration-muted-foreground/50 decoration-dotted underline-offset-4"
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A badge with its rule behind it. */
export function HintBadge({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" asChild className="cursor-help text-muted-foreground">
            <button type="button">{children}</button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A long table that opens on request: the first rows show, the rest wait
 * behind one button that says how many there are. Rows past the fold carry
 * `hidden group-data-[expanded=true]:table-row`, so nothing is re-fetched
 * and the page stays one request (spec: usage-page).
 */
export function ShowAll({
  total,
  shown,
  noun,
  children,
}: {
  total: number;
  shown: number;
  noun: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (total <= shown) return <>{children}</>;
  return (
    <div data-expanded={expanded} className="group flex flex-col">
      {children}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="border-t px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? `Show the first ${shown}` : `Show all ${total} ${noun}`}
      </button>
    </div>
  );
}
