"use client";

import { Button } from "@deskbell/ui/components/button";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { cn } from "@deskbell/ui/lib/utils";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";

import type { ConversationCounts, ConversationListRow } from "@/lib/conversations-list";
import {
  type ConversationsFilter,
  type ConversationsView,
  conversationsHref,
  formatPeriod,
  PERIOD_LABELS,
  type PeriodKey,
  parseDay,
  resolveRange,
  shiftDay,
  todayUtc,
} from "@/lib/conversations-view";
import { avatarClass, initialOf, relativeTime } from "@/lib/inbox";

export type InboxItem = ConversationListRow;

const FILTERS: { key: ConversationsFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "uncertain", label: "Uncertain" },
  { key: "down", label: "Downvoted" },
];

const PERIODS: PeriodKey[] = ["all", "today", "7d", "30d", "90d", "custom"];

/**
 * Split inbox shell: list pane + thread pane. Below `md` the panes swap on
 * navigation (list on the index route, thread when a conversation is open),
 * which is why this is a client component keyed on the pathname. The list
 * itself is the `@list` slot, rendered by the server for the view in the URL.
 */
export function InboxShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const threadOpen = pathname !== "/conversations";
  return (
    <div className="flex h-[calc(100svh-var(--header-height))] overflow-hidden md:h-[calc(100svh-var(--header-height)-1rem)]">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-80",
          threadOpen ? "hidden" : "flex",
        )}
      >
        {list}
      </aside>
      <div className={cn("min-w-0 flex-1 flex-col md:flex", threadOpen ? "flex" : "hidden")}>
        {children}
      </div>
    </div>
  );
}

/**
 * The list pane (spec: conversations-inbox-polish, conversations-date-range).
 * The view is the URL: the period is a select that navigates, the filter
 * segments are links, and every row link carries the view along so the index
 * page opens the newest thread of the same view.
 */
export function InboxList({
  rows,
  counts,
  view,
  labels = { topic: null, context: null },
}: {
  rows: InboxItem[];
  /** What each filter segment of this period would list. */
  counts: ConversationCounts;
  view: ConversationsView;
  /** What the view's topic and context narrowing are called, when set. */
  labels?: { topic: string | null; context: string | null };
}) {
  const pathname = usePathname();
  const threadOpen = pathname !== "/conversations";
  const chips = [
    view.topic
      ? { name: "Topic", value: labels.topic ?? view.topic, clear: { topic: null } }
      : null,
    view.context
      ? {
          name: view.context.key,
          value: labels.context ?? view.context.id,
          clear: { context: null },
        }
      : null,
  ].filter((c) => c !== null);

  return (
    <>
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
        <PeriodControl view={view}>
          <span className="truncate text-sm font-semibold">
            {rows.length} {rows.length === 1 ? "conversation" : "conversations"}
          </span>
        </PeriodControl>
        <nav aria-label="Filter" className="flex rounded-md border">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              asChild
              variant={f.key === view.filter ? "secondary" : "ghost"}
              size="sm"
              // Three labels and their counts must fit the 20rem pane at
              // three digits each: tighter padding and gap than the default.
              className="min-w-0 flex-1 gap-1 rounded-none px-2 text-xs first:rounded-l-md last:rounded-r-md"
            >
              {/* The count follows the label so each link's name is a stable prefix. */}
              <Link
                href={conversationsHref("/conversations", { ...view, filter: f.key })}
                aria-current={f.key === view.filter ? "page" : undefined}
              >
                {f.label}
                <span className="tabular-nums text-muted-foreground">{counts[f.key]}</span>
              </Link>
            </Button>
          ))}
        </nav>
        {chips.length > 0 ? (
          <ul aria-label="Narrowed to" className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.name}
                className="flex min-w-0 items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
              >
                <span className="text-muted-foreground">{chip.name}:</span>
                <span className="truncate font-medium">{chip.value}</span>
                <Link
                  href={conversationsHref("/conversations", { ...view, ...chip.clear })}
                  aria-label={`Remove ${chip.name} filter`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage(view, counts)}
          </p>
        ) : (
          rows.map((item, index) => {
            // With no thread in the path, the index page shows the newest
            // thread of this view: the first row is the open one.
            const active = threadOpen ? pathname === `/conversations/${item.id}` : index === 0;
            return (
              <Link
                key={item.id}
                href={conversationsHref(`/conversations/${item.id}`, view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                    avatarClass(item.sessionId),
                  )}
                >
                  {initialOf(item.title)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.snippet ?? "No messages"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                  {/* Relative time drifts between server render and hydration. */}
                  <span
                    className="text-[11px] text-muted-foreground tabular-nums"
                    suppressHydrationWarning
                  >
                    {relativeTime(item.time)}
                  </span>
                  {item.uncertain ? (
                    <span
                      className="size-2 rounded-full bg-uncertain"
                      title="Contains an uncertain answer — refused or weakly grounded"
                    />
                  ) : null}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}

function emptyMessage(view: ConversationsView, counts: ConversationCounts): string {
  if (view.period !== "all" && counts.all === 0) {
    return view.period === "custom"
      ? `No conversations between ${formatPeriod(view).replace(" – ", " and ")}.`
      : `No conversations in the ${PERIOD_LABELS[view.period].toLowerCase()}.`;
  }
  if (counts.all === 0)
    return "No conversations yet — ring the bell in the corner or hit “Ask a question” to try the widget.";
  if (view.filter === "down") return "No answer has been marked down.";
  return "Every answer was grounded above the weak floor.";
}

/**
 * The period: a select of the Gaps page's periods plus today and a custom
 * range. A preset navigates at once; custom opens two date fields on their
 * own row, which navigate as soon as both hold a day. The trigger names the
 * view — a preset's label, or the custom days — so the pane says what it is
 * showing. `children` is the count that shares the select's row.
 */
function PeriodControl({ view, children }: { view: ConversationsView; children: ReactNode }) {
  const router = useRouter();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const custom = view.period === "custom";
  const showFields = custom || editing;
  // The fields start on the current period's days, or the last 30 days.
  const initial = resolveRange(view, todayUtc()) ?? {
    from: shiftDay(todayUtc(), -29),
    to: todayUtc(),
  };
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const go = (next: ConversationsView) => router.push(conversationsHref("/conversations", next));

  const onPeriod = (value: string) => {
    const period = value as PeriodKey;
    if (period === "custom") {
      setEditing(true);
      return;
    }
    setEditing(false);
    go({ ...view, period, from: null, to: null });
  };

  const onDays = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    const a = parseDay(nextFrom);
    const b = parseDay(nextTo);
    if (a && b) go({ ...view, period: "custom", from: a, to: b });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {children}
        <Select value={showFields ? "custom" : view.period} onValueChange={onPeriod}>
          <SelectTrigger size="sm" className="h-7 shrink-0 text-xs" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {PERIODS.map((key) => (
              <SelectItem key={key} value={key} className="text-xs">
                {key === "custom" && custom ? formatPeriod(view) : PERIOD_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showFields ? (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${id}-from`} className="sr-only">
            From
          </Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            max={to}
            onChange={(e) => onDays(e.target.value, to)}
            className="h-7 min-w-0 flex-1 px-1.5 text-xs"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Label htmlFor={`${id}-to`} className="sr-only">
            To
          </Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            min={from}
            onChange={(e) => onDays(from, e.target.value)}
            className="h-7 min-w-0 flex-1 px-1.5 text-xs"
          />
        </div>
      ) : null}
    </div>
  );
}
