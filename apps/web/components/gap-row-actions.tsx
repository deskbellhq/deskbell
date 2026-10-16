"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import {
  Check,
  CircleCheck,
  ClipboardList,
  Copy,
  MoreHorizontal,
  PenLine,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { copyLabel, useCopy } from "@/lib/use-copy";

/**
 * The row's occasional actions behind one kebab (spec: gap-analysis-feedback):
 * copying the task brief or the eval case, writing the answer, and resolving
 * or reopening the cluster. Details stays a visible link because it is the way into every
 * row; these are the things done once per gap. Writing is a link into the
 * drawer's form (spec: gap-drawer-url-state), so the row owns no drawer.
 */
export function GapRowActions({
  task,
  evalCase,
  clusterId,
  status,
  resolve,
  reopen,
  hasAnswer,
  writeHref,
}: {
  /** The cluster as a task brief (spec: gap-task-brief), ready for the clipboard. */
  task: string;
  /** The eval-case skeleton, ready for the clipboard. */
  evalCase: string;
  /** Null until the worker has grouped the row; resolve needs a cluster. */
  clusterId: string | null;
  status: "open" | "resolved";
  resolve: (clusterId: string) => Promise<void>;
  reopen: (clusterId: string) => Promise<void>;
  /** An answer exists for this cluster (spec: corrections-source). */
  hasAnswer: boolean;
  /** The drawer in writing mode; null until the worker has grouped the row. */
  writeHref: string | null;
}) {
  const taskCopy = useCopy();
  const evalCopy = useCopy();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="More actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={(event) => {
            // Stay open long enough to show that it worked.
            event.preventDefault();
            taskCopy.copy(task);
          }}
        >
          {taskCopy.state === "copied" ? <Check /> : <ClipboardList />}
          {copyLabel(taskCopy.state, "Copy prompt for your coding agent")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            evalCopy.copy(evalCase);
          }}
        >
          {evalCopy.state === "copied" ? <Check /> : <Copy />}
          {copyLabel(evalCopy.state, "Copy as eval case")}
        </DropdownMenuItem>
        {writeHref ? (
          <DropdownMenuItem asChild>
            <Link href={writeHref} scroll={false}>
              <PenLine />
              {hasAnswer ? "Edit answer" : "Write an answer"}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <PenLine />
            Write an answer
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {status === "resolved" ? (
          <DropdownMenuItem
            disabled={!clusterId || pending}
            onSelect={() => {
              if (clusterId) startTransition(() => reopen(clusterId));
            }}
          >
            <RotateCcw />
            Reopen
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!clusterId || pending}
            onSelect={() => {
              if (clusterId) startTransition(() => resolve(clusterId));
            }}
          >
            <CircleCheck />
            Mark resolved
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
