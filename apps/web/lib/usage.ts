/**
 * Usage (spec: usage-page): pure shaping over the rows `lib/usage-query`
 * fetched — which split values become series, how a day series is filled and
 * rolled into weeks, how a delta reads. No database here, so it is testable
 * without one and importable by the chart, a client component.
 */

/** The split value of a conversation that does not carry the split key. */
export const NO_SEGMENT = "";
/** The folded tail of a split with more values than series. */
export const OTHER_SEGMENT = "__other__";
/** Series cap: the palette has six validated slots, and a legend past that stops being read. */
export const SEGMENT_CAP = 6;

export interface SegmentCount {
  /** The context id, or NO_SEGMENT. */
  segment: string;
  /** The latest name the host sent for this id; null when none or for NO_SEGMENT. */
  name: string | null;
  conversations: number;
}

export interface Segment {
  id: string;
  label: string;
}

/**
 * Which split values get a series of their own: the top values by
 * conversations, then "Other" for the rest and "No <key>" for conversations
 * without the key, each only when it has anything in it. Order is by size,
 * so the legend reads largest first; a value keeps its colour across periods
 * only as long as its rank holds, which the page accepts for a six-slot legend.
 */
export function pickSegments(rows: SegmentCount[], key: string, cap = SEGMENT_CAP): Segment[] {
  const named = rows
    .filter((r) => r.segment !== NO_SEGMENT && r.conversations > 0)
    .sort((a, b) => b.conversations - a.conversations || a.segment.localeCompare(b.segment));
  const none = rows.find((r) => r.segment === NO_SEGMENT && r.conversations > 0);
  // Keep one slot for the fold when it is needed, so Other never pushes a kept value out.
  const room = named.length > cap ? cap - 1 : cap;
  const kept = named.slice(0, room).map((r) => ({ id: r.segment, label: r.name || r.segment }));
  if (named.length > room) kept.push({ id: OTHER_SEGMENT, label: "Other" });
  if (none) kept.push({ id: NO_SEGMENT, label: `No ${key}` });
  return kept;
}

/** The series a raw segment counts under, given the segments that were kept. */
export function foldSegment(segment: string, segments: readonly Segment[]): string {
  return segments.some((s) => s.id === segment) ? segment : OTHER_SEGMENT;
}

/** Totals per raw segment, folded onto the kept series. */
export function foldTotals<T extends { segment: string }>(
  rows: T[],
  segments: readonly Segment[],
  add: (into: T, row: T) => T,
  empty: (segment: string) => T,
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const id = foldSegment(row.segment, segments);
    const into = byId.get(id) ?? empty(id);
    byId.set(id, add(into, row));
  }
  return segments.map((s) => byId.get(s.id) ?? empty(s.id));
}

export interface DayCount {
  /** YYYY-MM-DD, UTC. */
  day: string;
  segment: string;
  questions: number;
}

/** One chart row: a day, and a count per series under the series' chart key. */
export type ChartRow = { date: string } & Record<string, number | string>;

/** The chart key a series uses in a row: stable and free of the id's characters. */
export const seriesKey = (index: number) => `s${index}`;

export function shiftUtcDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every UTC day from `from` to `to` inclusive, each series zero-filled. */
export function zeroFilledDays(
  rows: DayCount[],
  range: { from: string; to: string },
  segments: readonly Segment[],
): ChartRow[] {
  const index = new Map(segments.map((s, i) => [s.id, seriesKey(i)]));
  const byDay = new Map<string, ChartRow>();
  for (let day = range.from; day <= range.to; day = shiftUtcDay(day, 1)) {
    const row: ChartRow = { date: day };
    for (const key of index.values()) row[key] = 0;
    byDay.set(day, row);
  }
  for (const r of rows) {
    const row = byDay.get(r.day);
    const key = index.get(foldSegment(r.segment, segments));
    if (!row || !key) continue;
    row[key] = Number(row[key] ?? 0) + r.questions;
  }
  return [...byDay.values()];
}

/** The Monday of a UTC day's week. */
export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return shiftUtcDay(day, -offset);
}

/** Day rows rolled into weeks starting Monday; the row's date is the week's Monday. */
export function weeklyRows(days: ChartRow[]): ChartRow[] {
  const byWeek = new Map<string, ChartRow>();
  for (const day of days) {
    const start = weekStart(day.date);
    const row = byWeek.get(start) ?? { date: start };
    for (const [key, value] of Object.entries(day)) {
      if (key === "date") continue;
      row[key] = Number(row[key] ?? 0) + Number(value);
    }
    byWeek.set(start, row);
  }
  return [...byWeek.values()];
}

/** The chart's day range: the period, or the last 90 days of an unbounded one. */
export function chartRange(
  from: Date | null,
  now: Date,
  fallbackDays = 90,
): {
  from: string;
  to: string;
} {
  const to = now.toISOString().slice(0, 10);
  const start = from ? from.toISOString().slice(0, 10) : shiftUtcDay(to, 1 - fallbackDays);
  return { from: start, to };
}

/** "+12", "-3" or "no change", with the previous value for the title. */
export function deltaLabel(now: number, before: number): string {
  const diff = now - before;
  return diff === 0 ? "no change" : diff > 0 ? `+${diff}` : String(diff);
}

/** A share as a whole percent, or null when there is nothing to divide by. */
/**
 * A power user asked on this many different days of the period or more.
 * Volume is not habit: the rule counts days, not questions, so one long
 * afternoon never qualifies and nine short mornings do.
 */
export const POWER_USER_DAYS = 3;

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** A labelled count the query returns: one label in one segment. */
export interface LabelCount {
  /** The stored key, or null for questions not yet labelled. */
  key: string | null;
  segment: string;
  questions: number;
  conversations: number;
}

/** One table row of a labelled breakdown, folded onto the kept series. */
export interface LabelRow {
  key: string | null;
  questions: number;
  conversations: number;
  /** Questions per kept series id, the rest under OTHER_SEGMENT. */
  perSegment: Map<string, number>;
  /** Questions in the period before; null when there is no previous period. */
  before: number | null;
}

/**
 * Rows for a labelled table (spec: usage-page, intent-and-signals): counts
 * summed per label across segments, each segment folded onto the kept
 * series, the previous period's count joined by key. Named labels first by
 * size, then the built-in bucket, then the not-yet-labelled row, so the
 * reader meets the real groupings before the remainder.
 */
export function labelRows(
  rows: LabelCount[],
  segments: readonly Segment[],
  previous: Array<{ key: string | null; questions: number }> | null,
  bucket: string | null,
): LabelRow[] {
  const byKey = new Map<string | null, LabelRow>();
  for (const row of rows) {
    const entry = byKey.get(row.key) ?? {
      key: row.key,
      questions: 0,
      conversations: 0,
      perSegment: new Map<string, number>(),
      before: null,
    };
    entry.questions += row.questions;
    entry.conversations += row.conversations;
    const id = foldSegment(row.segment, segments);
    entry.perSegment.set(id, (entry.perSegment.get(id) ?? 0) + row.questions);
    byKey.set(row.key, entry);
  }
  const previousByKey = new Map(previous?.map((p) => [p.key, p.questions]) ?? []);
  const rank = (key: string | null) => (key === null ? 2 : key === bucket ? 1 : 0);
  return [...byKey.values()]
    .map((row) => ({
      ...row,
      before: previous ? (previousByKey.get(row.key) ?? 0) : null,
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || b.questions - a.questions);
}

export interface CompositionPart {
  key: string;
  share: number;
  /** The fold: everything not among the named leaders. */
  muted: boolean;
}

/**
 * The share picture above a labelled table: the largest named labels, up to
 * `keep`, and one muted part for everything else — the bucket, the
 * not-yet-labelled and any named label past the cap. Null when there is
 * nothing to divide.
 */
export function composition(
  rows: readonly LabelRow[],
  total: number,
  bucket: string | null,
  keep = 5,
): CompositionPart[] | null {
  if (total <= 0) return null;
  const named = rows.filter((r) => r.key !== null && r.key !== bucket).slice(0, keep);
  const shown = named.reduce((n, r) => n + r.questions, 0);
  const parts: CompositionPart[] = named.map((r) => ({
    key: r.key ?? "",
    share: percent(r.questions, total) ?? 0,
    muted: false,
  }));
  if (total > shown)
    parts.push({ key: "__rest__", share: percent(total - shown, total) ?? 0, muted: true });
  return parts;
}
