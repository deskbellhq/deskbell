"use client";

import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@deskbell/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import { Separator } from "@deskbell/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { useIsMobile } from "@deskbell/ui/hooks/use-mobile";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { z } from "zod";

import { threadStatusDetail } from "@/lib/thread-status";

import { FeedbackGlyph } from "./feedback-glyph";
import { ThreadStatusBadge } from "./thread-status-badge";

export const conversationSchema = z.object({
  id: z.string(),
  question: z.string(),
  channel: z.enum(["widget", "slack", "api"]),
  status: z.enum(["certain", "uncertain", "unanswered"]),
  /** The answer to the titling question, truncated server-side for the preview drawer. */
  answer: z.string().nullable(),
  feedback: z.enum(["up", "down", "none"]),
  citations: z.number(),
  /** User messages in the thread; more than one means the preview is only the first turn. */
  turns: z.number(),
  /** Refused answers in the thread; with several turns, the row says how many. */
  refusals: z.number(),
  /** Answers written from retrieval under the weak floor — uncertain without a refusal. */
  weak: z.number(),
  /** Answers that named something the documentation does not contain (spec: answer-verification). */
  unsupported: z.number(),
  date: z.string(),
});

export type Conversation = z.infer<typeof conversationSchema>;

const channelLabels: Record<Conversation["channel"], string> = {
  widget: "Widget",
  slack: "Slack",
  api: "API",
};

/**
 * One uncertain answer marks a thread (spec: sources-line-and-thread-status),
 * which hides why and, on a long thread, its shape. The line beside the badge
 * says both: "refused", "weak grounding", or "1 of 4 refused · 1 weak".
 */
function StatusCell({ item }: { item: Conversation }) {
  const detail = threadStatusDetail(item);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ThreadStatusBadge status={item.status} />
      {detail ? <span className="text-muted-foreground text-xs tabular-nums">{detail}</span> : null}
    </span>
  );
}

function FeedbackCell({ feedback }: { feedback: Conversation["feedback"] }) {
  if (!feedback || feedback === "none") return <span className="text-muted-foreground">—</span>;
  return <FeedbackGlyph feedback={feedback} className="size-4" />;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function QuestionCell({ item }: { item: Conversation }) {
  const isMobile = useIsMobile();

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="w-fit max-w-md truncate px-0 text-left text-foreground">
          {item.question}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle className="text-left">{item.question}</DrawerTitle>
          <DrawerDescription className="text-left">
            {channelLabels[item.channel]} · {formatDate(item.date)}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusCell item={item} />
            <Badge variant="secondary">{item.citations} citations</Badge>
            {item.turns > 1 ? <Badge variant="secondary">{item.turns} questions</Badge> : null}
          </div>
          <Separator />
          {item.answer ? (
            <p className="whitespace-pre-wrap text-muted-foreground">{item.answer}</p>
          ) : (
            <p className="text-muted-foreground italic">
              {item.refusals > 0
                ? "The agent declined: no grounded answer was found — logged as a gap."
                : "No answer was produced for this question."}
            </p>
          )}
        </div>
        <DrawerFooter>
          <Button asChild>
            <Link href={`/conversations/${item.id}`}>Open in Conversations</Link>
          </Button>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

const columns: ColumnDef<Conversation>[] = [
  {
    accessorKey: "question",
    header: "Question",
    cell: ({ row }) => <QuestionCell item={row.original} />,
    enableHiding: false,
  },
  {
    accessorKey: "channel",
    header: "Channel",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {channelLabels[row.original.channel]}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusCell item={row.original} />,
  },
  {
    accessorKey: "feedback",
    header: () => <div className="text-center">Feedback</div>,
    cell: ({ row }) => (
      <div className="flex justify-center">
        <FeedbackCell feedback={row.original.feedback} />
      </div>
    ),
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{formatDate(row.original.date)}</span>
    ),
  },
];

export function DataTable({ data: rawData }: { data: unknown[] }) {
  const data = React.useMemo(() => z.array(conversationSchema).parse(rawData), [rawData]);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "date", desc: true }]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="flex w-full flex-col justify-start gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">Recent conversations</h2>
          <p className="text-sm text-muted-foreground">
            What your users asked, and how the agent did
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns2 />
              <span className="hidden lg:inline">Columns</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No conversations yet — they appear once your widget answers its first question.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2 lg:gap-4">
          <div className="text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden size-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8 p-0"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8 p-0"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
