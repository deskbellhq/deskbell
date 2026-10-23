"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { type PeriodKey, type UsageView, usageHref, withoutFilter } from "@/lib/usage-view";

/**
 * Period, split, breakdown and filters for the usage page (spec: usage-page).
 * All of it lives in the URL so a view is a link: the period is a row of
 * links, the two keys are selects that rewrite the query string and keep the
 * rest, and each active filter is a chip whose × is a link to the view
 * without it.
 */
const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: "7d", label: "Last 7 days", short: "7d" },
  { key: "30d", label: "Last 30 days", short: "30d" },
  { key: "90d", label: "Last 90 days", short: "90d" },
  { key: "all", label: "All time", short: "All" },
];

const NONE = "__none__";

export function UsageToolbar({
  view,
  keys,
  filterLabels,
}: {
  view: UsageView;
  /** Context keys any conversation in the period carries. */
  keys: string[];
  /** What each active filter's id is called, when the host sent a name. */
  filterLabels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const href = (next: Partial<UsageView>) => usageHref(pathname, { ...view, ...next });
  // A key in the URL that no conversation of the period carries still has to
  // be selectable, or the control would show a value it does not list.
  const options = [...new Set([...keys, view.split, view.by].filter((k): k is string => !!k))];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex rounded-md border">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              asChild
              variant={p.key === view.period ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none first:rounded-l-md last:rounded-r-md"
            >
              <Link
                href={href({ period: p.key })}
                aria-current={p.key === view.period ? "page" : undefined}
              >
                <span className="hidden sm:inline">{p.label}</span>
                <span className="sm:hidden">{p.short}</span>
              </Link>
            </Button>
          ))}
        </nav>
        <KeySelect
          label="Split by"
          value={view.split}
          options={options}
          onChange={(split) => router.push(href({ split }))}
        />
        <KeySelect
          label="Break down by"
          value={view.by}
          options={options}
          onChange={(by) => router.push(href({ by }))}
        />
      </div>
      {view.filters.length > 0 ? (
        <ul aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
          {view.filters.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
            >
              <span className="text-muted-foreground">{f.key}:</span>
              <span className="font-medium">{filterLabels[f.key] ?? f.id}</span>
              <Link
                href={usageHref(pathname, withoutFilter(view, f.key))}
                aria-label={`Remove filter ${f.key}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function KeySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (key: string | null) => void;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className="w-56" aria-label={label}>
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {options.map((key) => (
          <SelectItem key={key} value={key}>
            {key}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
