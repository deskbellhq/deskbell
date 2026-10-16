import { Button } from "@deskbell/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { PanelRight } from "lucide-react";
import Link from "next/link";

import { StatusChip } from "@/components/action-call-detail";
import { type LogRow, shortQuestion } from "@/lib/actions/log";
import { relativeTime } from "@/lib/inbox";
import { formatLatency } from "@/lib/latency";

/**
 * Calls as a table (spec: actions-log, actions-ia): the log shows every
 * tool, a tool's own page shows only its calls and hides the column that
 * would repeat the page title.
 */
export function ActionCallsTable({
  rows,
  detailHref,
  showTool = true,
}: {
  rows: LogRow[];
  detailHref: (row: LogRow) => string;
  showTool?: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="w-28">When</TableHead>
          {showTool ? <TableHead>Tool</TableHead> : null}
          <TableHead>Conversation</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-testid={`call-${r.id}`}>
            <TableCell
              className="whitespace-nowrap text-muted-foreground"
              title={new Date(r.createdAt).toLocaleString()}
            >
              {relativeTime(r.createdAt)}
            </TableCell>
            {showTool ? (
              <TableCell>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {r.serverName ?? <span className="italic">server removed</span>}
                </div>
              </TableCell>
            ) : null}
            <TableCell className="max-w-xs">
              <Link
                href={`/conversations/${r.conversationId}`}
                className="block truncate underline-offset-4 hover:underline"
                title={r.question ?? undefined}
              >
                {shortQuestion(r.question) ?? <span className="italic">(no question)</span>}
              </Link>
              {r.visitorName ? (
                <div className="text-xs text-muted-foreground">{r.visitorName}</div>
              ) : null}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <div className="flex items-center gap-2">
                <StatusChip status={r.status} />
                {r.latencyMs != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatLatency(r.latencyMs)}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" asChild>
                <Link href={detailHref(r)} scroll={false}>
                  <PanelRight />
                  Details
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
