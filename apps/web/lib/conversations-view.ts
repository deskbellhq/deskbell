/**
 * The conversations page's URL state (spec: conversations-inbox-polish,
 * conversations-date-range): a filter and a period, and the one builder that
 * turns a view into a link, so the list header, the rows, the index page and
 * the Overview chart agree on what a view is called.
 *
 * Import-free, like ./gaps-view: the inbox controls are client components.
 */

export type ConversationsFilter = "all" | "uncertain" | "down";
export const DEFAULT_FILTER: ConversationsFilter = "all";
const FILTERS: readonly ConversationsFilter[] = ["all", "uncertain", "down"];

/**
 * The periods the Gaps page offers, plus today (a chart column) and a custom
 * range. Relative periods are relative to the day the page is read, so a
 * link to "last 7 days" stays "last 7 days"; a custom range is two fixed
 * days, which is what a chart column or a bookmarked week needs.
 */
export type PeriodKey = "all" | "today" | "7d" | "30d" | "90d" | "custom";
export const DEFAULT_PERIOD: PeriodKey = "all";
const RELATIVE_PERIODS = ["today", "7d", "30d", "90d"] as const;
const PERIOD_DAYS: Record<(typeof RELATIVE_PERIODS)[number], number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};

export interface ConversationsView {
  filter: ConversationsFilter;
  period: PeriodKey;
  /** Both set for a custom period, YYYY-MM-DD in UTC, from <= to; null otherwise. */
  from: string | null;
  to: string | null;
}

export const DEFAULT_VIEW: ConversationsView = {
  filter: DEFAULT_FILTER,
  period: DEFAULT_PERIOD,
  from: null,
  to: null,
};

/** Inclusive UTC calendar days, the chart's buckets. */
export interface DayRange {
  from: string;
  to: string;
}

type Param = string | string[] | null | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value) ?? null;

export function parseFilter(value: Param): ConversationsFilter {
  const v = first(value);
  return (FILTERS as readonly string[]).includes(v ?? "")
    ? (v as ConversationsFilter)
    : DEFAULT_FILTER;
}

/** A day is kept only when it is a real calendar date written as the chart writes it. */
export function parseDay(value: Param): string | null {
  const v = first(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const date = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v ? null : v;
}

/**
 * `period` wins when it names a relative period; otherwise a custom range
 * needs both ends (swapped into order when reversed); anything else is all
 * time. A bad value is ignored, never an error.
 */
export function parseView(params: {
  filter?: Param;
  period?: Param;
  from?: Param;
  to?: Param;
}): ConversationsView {
  const filter = parseFilter(params.filter);
  const period = first(params.period);
  if ((RELATIVE_PERIODS as readonly string[]).includes(period ?? "")) {
    return { filter, period: period as PeriodKey, from: null, to: null };
  }
  const from = parseDay(params.from);
  const to = parseDay(params.to);
  if (from && to) {
    return from <= to
      ? { filter, period: "custom", from, to }
      : { filter, period: "custom", from: to, to: from };
  }
  return { filter, period: DEFAULT_PERIOD, from: null, to: null };
}

/** A link to a view; defaults are omitted from the URL. */
export function conversationsHref(pathname: string, view: ConversationsView): string {
  const params = new URLSearchParams();
  if (view.filter !== DEFAULT_FILTER) params.set("filter", view.filter);
  if (view.period === "custom" && view.from && view.to) {
    params.set("from", view.from);
    params.set("to", view.to);
  } else if (view.period !== DEFAULT_PERIOD && view.period !== "custom") {
    params.set("period", view.period);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Today as the chart writes it: a UTC calendar day. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The days a view covers, or null for all time. A relative period counts
 * calendar days ending today, the way the chart's range toggle slices its
 * rows: "last 7 days" is today and the six before it.
 */
export function resolveRange(view: ConversationsView, today: string): DayRange | null {
  if (view.period === "custom")
    return view.from && view.to ? { from: view.from, to: view.to } : null;
  if (view.period === "all") return null;
  return { from: shiftDay(today, 1 - PERIOD_DAYS[view.period]), to: today };
}

/** "Sep 22" for a day, read as UTC so it names the chart's column. */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** What the period control shows for a view: a label, or the custom days. */
export function formatPeriod(view: ConversationsView): string {
  if (view.period !== "custom" || !view.from || !view.to) return PERIOD_LABELS[view.period];
  return view.from === view.to
    ? formatDay(view.from)
    : `${formatDay(view.from)} – ${formatDay(view.to)}`;
}
