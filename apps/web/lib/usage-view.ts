import { DEFAULT_PERIOD, type PeriodKey } from "./gaps-view";

/**
 * The usage page's URL state (spec: usage-page): a period, the context key
 * the numbers are split by, the context key the breakdown table lists, and
 * the context filters, as `ctx.<key>=<id>`. Import-free like ./gaps-view so
 * the toolbar, a client component, can build links without pulling the
 * database package into the browser bundle.
 */

export type { PeriodKey };

export interface UsageFilter {
  key: string;
  id: string;
}

export interface UsageView {
  period: PeriodKey;
  /** Context key whose values split every number, or null for one series. */
  split: string | null;
  /** Context key the breakdown table lists one row per value of, or null for none. */
  by: string | null;
  /** Conversations must carry every one of these; one id per key. */
  filters: UsageFilter[];
}

export const DEFAULT_USAGE_VIEW: UsageView = {
  period: DEFAULT_PERIOD,
  split: null,
  by: null,
  filters: [],
};

const PERIODS: readonly PeriodKey[] = ["7d", "30d", "90d", "all"];
/** The context key rule, as the widget's request schema states it. */
const CONTEXT_KEY = /^[a-z][a-z0-9_-]{0,63}$/i;
const CONTEXT_ID_MAX = 128;
const FILTER_PREFIX = "ctx.";

type Param = string | string[] | null | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value) ?? null;

export function isContextKey(value: string | null): value is string {
  return value !== null && CONTEXT_KEY.test(value);
}

/** A bad value is ignored, never an error: a stale link shows the usual view. */
export function parseUsageView(params: Record<string, Param>): UsageView {
  const period = first(params.period);
  const split = first(params.split);
  const by = first(params.by);
  const filters: UsageFilter[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (!name.startsWith(FILTER_PREFIX)) continue;
    const key = name.slice(FILTER_PREFIX.length);
    const id = first(value);
    if (!isContextKey(key) || !id || id.length > CONTEXT_ID_MAX) continue;
    if (filters.some((f) => f.key === key)) continue;
    filters.push({ key, id });
  }
  return {
    period: PERIODS.includes(period as PeriodKey) ? (period as PeriodKey) : DEFAULT_PERIOD,
    split: isContextKey(split) ? split : null,
    by: isContextKey(by) ? by : null,
    filters,
  };
}

/** The one link builder; defaults are omitted so two links to one view are one string. */
export function usageHref(pathname: string, view: UsageView): string {
  const params = new URLSearchParams();
  if (view.period !== DEFAULT_PERIOD) params.set("period", view.period);
  if (view.split) params.set("split", view.split);
  if (view.by) params.set("by", view.by);
  for (const f of view.filters) params.set(`${FILTER_PREFIX}${f.key}`, f.id);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The view with one filter added or replaced. */
export function withFilter(view: UsageView, filter: UsageFilter): UsageView {
  return {
    ...view,
    filters: [...view.filters.filter((f) => f.key !== filter.key), filter],
  };
}

/** The view with one filter removed. */
export function withoutFilter(view: UsageView, key: string): UsageView {
  return { ...view, filters: view.filters.filter((f) => f.key !== key) };
}
