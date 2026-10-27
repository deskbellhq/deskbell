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
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";

import { ConversationsFilterMenu } from "@/components/conversations-filter-menu";
import { type FilterChip, FilterChips } from "@/components/filter-chips";
import { AttentionGlyphs, StatusDisc } from "@/components/thread-marks";
import type {
  ContextValues,
  ConversationCounts,
  ConversationListRow,
} from "@/lib/conversations-list";
import {
  type ConversationsView,
  conversationsHref,
  FEEDBACK_LABELS,
  formatPeriod,
  isNarrowed,
  OUTCOME_LABELS,
  PERIOD_LABELS,
  type PeriodKey,
  parseDay,
  type QuickView,
  resolveRange,
  shiftDay,
  todayUtc,
} from "@/lib/conversations-view";
import { relativeTime } from "@/lib/inbox";

export type InboxItem = ConversationListRow;

/** The two lists above the inbox (spec: attention-inbox). */
const QUICK_VIEWS: { key: QuickView; label: string; title: string }[] = [
  { key: "all", label: "All", title: "Every thread in the period" },
  {
    key: "attention",
    label: "Needs attention",
    title: "Uncertain, marked down, or a question that asked for a person or pushed back",
  },
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
 * The list pane (spec: conversations-inbox-polish, conversations-date-range,
 * attention-inbox). The view is the URL: the period is a select that
 * navigates, the quick views are links with their counts, every narrowing
 * is a chip with a way back and is added from one menu, and every row link
 * carries the view along so the index page opens the newest thread of the
 * same view.
 *
 * A row answers three questions in three places: the status disc says how
 * the answers went, the text says what the thread is, the trailing glyphs
 * say why a person should read it. Nothing else is drawn on a row.
 */
export function InboxList({
  rows,
  counts,
  view,
  labels,
  topics,
  contextValues,
  intentNames,
  signalNames,
}: {
  rows: InboxItem[];
  /** What each quick view of this period would list. */
  counts: ConversationCounts;
  view: ConversationsView;
  /** What the view's topic, intent, signal, context and visitor narrowing are called, when set. */
  labels: {
    topic: string | null;
    intent: string | null;
    signal: string | null;
    context: string | null;
    user: string | null;
  };
  topics: Parameters<typeof ConversationsFilterMenu>[0]["topics"];
  contextValues: ContextValues[];
  intentNames: Record<string, string>;
  signalNames: Record<string, string>;
}) {
  const pathname = usePathname();
  const threadOpen = pathname !== "/conversations";
  const clear = (next: Partial<ConversationsView>) =>
    conversationsHref("/conversations", { ...view, ...next });
  const chips: FilterChip[] = [
    view.outcome
      ? {
          name: "Outcome",
          value: OUTCOME_LABELS[view.outcome],
          clearHref: clear({ outcome: null }),
        }
      : null,
    view.feedback
      ? {
          name: "Feedback",
          value: FEEDBACK_LABELS[view.feedback],
          clearHref: clear({ feedback: null }),
        }
      : null,
    view.topic
      ? { name: "Topic", value: labels.topic ?? view.topic, clearHref: clear({ topic: null }) }
      : null,
    view.intent
      ? { name: "Intent", value: labels.intent ?? view.intent, clearHref: clear({ intent: null }) }
      : null,
    view.signal
      ? { name: "Signal", value: labels.signal ?? view.signal, clearHref: clear({ signal: null }) }
      : null,
    view.context
      ? {
          name: view.context.key,
          value: labels.context ?? view.context.id,
          clearHref: clear({ context: null }),
        }
      : null,
    view.user
      ? { name: "Visitor", value: labels.user ?? view.user, clearHref: clear({ user: null }) }
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
        <div className="flex items-center gap-2">
          <nav aria-label="View" className="flex min-w-0 flex-1 rounded-md border">
            {QUICK_VIEWS.map((q) => (
              <Button
                key={q.key}
                asChild
                variant={q.key === view.view ? "secondary" : "ghost"}
                size="sm"
                className="min-w-0 flex-1 gap-1 rounded-none px-2 text-xs first:rounded-l-md last:rounded-r-md"
              >
                {/* The count follows the label so each link's name is a stable prefix. */}
                <Link
                  href={clear({ view: q.key })}
                  aria-current={q.key === view.view ? "page" : undefined}
                  title={q.title}
                >
                  <span className="truncate">{q.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {counts[q.key]}
                  </span>
                </Link>
              </Button>
            ))}
          </nav>
          <ConversationsFilterMenu
            view={view}
            topics={topics}
            contextValues={contextValues}
            intentNames={intentNames}
            signalNames={signalNames}
          />
        </div>
        <FilterChips label="Narrowed to" chips={chips} />
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
                  "flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <StatusDisc status={item.status} className="mt-[7px]" />
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
                  <AttentionGlyphs
                    downvoted={item.downvoted}
                    wantsHuman={item.wantsHuman}
                    pushback={item.pushback}
                  />
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
  if (view.period !== "all" && counts.all === 0 && !isNarrowed(view)) {
    return view.period === "custom"
      ? `No conversations between ${formatPeriod(view).replace(" – ", " and ")}.`
      : `No conversations in the ${PERIOD_LABELS[view.period].toLowerCase()}.`;
  }
  if (counts.all === 0 && !isNarrowed(view))
    return "No conversations yet — ring the bell in the corner or hit “Ask a question” to try the widget.";
  if (isNarrowed(view))
    return "No conversation matches these filters. Remove one, or widen the period.";
  return "Nothing needs attention: every answer was certain, and no one marked one down, asked for a person or pushed back.";
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
