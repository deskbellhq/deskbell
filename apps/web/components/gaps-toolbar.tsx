"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { Download } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { ExportFormat } from "@/lib/gaps-export";
import {
  gapsHref,
  type PeriodKey,
  type SortKey,
  type StatusCounts,
  type StatusKey,
} from "@/lib/gaps-view";

/**
 * Period, status and order for the gaps page (spec: gaps-period-and-ordering,
 * gaps-status-filter). All three live in the URL so a view is a link: the
 * period and the status are rows of links styled as segmented controls, the
 * sort a select that rewrites the query string and keeps the rest.
 */
const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: "7d", label: "Last 7 days", short: "7d" },
  { key: "30d", label: "Last 30 days", short: "30d" },
  { key: "90d", label: "Last 90 days", short: "90d" },
  { key: "all", label: "All time", short: "All" },
];

const STATUSES: { key: StatusKey; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Newest first" },
  { key: "frequent", label: "Most asked" },
  { key: "trending", label: "Trending" },
];

export function GapsToolbar({
  period,
  sort,
  status,
  counts,
}: {
  period: PeriodKey;
  sort: SortKey;
  status: StatusKey;
  /** What each status view of this period would show. */
  counts: StatusCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const href = (view: { period?: PeriodKey; sort?: SortKey; status?: StatusKey }) =>
    gapsHref(pathname, { period, sort, status, ...view });

  const exportHref = (format: ExportFormat) => {
    const params = new URLSearchParams({ format, period, sort, status });
    return `${pathname}/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="flex rounded-md border">
        {PERIODS.map((p) => (
          <Button
            key={p.key}
            asChild
            variant={p.key === period ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none first:rounded-l-md last:rounded-r-md"
          >
            <Link
              href={href({ period: p.key })}
              aria-current={p.key === period ? "page" : undefined}
            >
              <span className="hidden sm:inline">{p.label}</span>
              <span className="sm:hidden">{p.short}</span>
            </Link>
          </Button>
        ))}
      </nav>
      <nav aria-label="Status" className="flex rounded-md border">
        {STATUSES.map((s) => (
          <Button
            key={s.key}
            asChild
            variant={s.key === status ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none first:rounded-l-md last:rounded-r-md"
          >
            {/* The count follows the label so each link's name is a stable prefix. */}
            <Link
              href={href({ status: s.key })}
              aria-current={s.key === status ? "page" : undefined}
            >
              {s.label}
              <span className="tabular-nums text-muted-foreground">{counts[s.key]}</span>
            </Link>
          </Button>
        ))}
      </nav>
      <Select value={sort} onValueChange={(s) => router.push(href({ sort: s as SortKey }))}>
        <SelectTrigger size="sm" className="w-36" aria-label="Order">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Download />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            {/* Plain anchors: a download needs a navigation, not a client transition. */}
            <a href={exportHref("csv")} download>
              CSV for a spreadsheet
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportHref("dataset")} download>
              Eval dataset (JSON)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportHref("prompts")} download>
              Prompts for your coding agent
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
