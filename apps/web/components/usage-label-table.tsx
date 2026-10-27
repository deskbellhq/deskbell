import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Hint } from "@/components/usage-hint";
import {
  type CompositionPart,
  deltaLabel,
  type LabelRow,
  percent,
  type Segment,
} from "@/lib/usage";

/**
 * A labelled breakdown on the Usage page (spec: usage-page,
 * intent-and-signals): one row per label with its questions drawn as a bar,
 * its share of every question in the period, the change against the period
 * before, its conversations and, when the page is split, a column per
 * series. Topics, intents and signals are the same table with a different
 * list of labels, so the reader learns it once.
 *
 * Share is a picture before it is a number: when the page is not split, a
 * composition bar above the table shows the largest named labels in the
 * series colours and everything else in one muted part; the rows carry the
 * matching swatch. Split rows wear the series colours per segment instead.
 */

export const seriesColor = (i: number) => `var(--series-${(i % 6) + 1})`;
export const MUTED = "var(--muted-foreground)";
export const MUTED_SOFT = "color-mix(in oklab, var(--muted-foreground) 40%, transparent)";

export interface LabelPresentation {
  name: string;
  /** The rule behind the label, as the link's tooltip. */
  description?: string;
  /** Where the label leads; null for a label that is not a door. */
  href: string | null;
}

export interface LabelTableHints {
  /** The first column's head. */
  column: string;
  label: string;
  questions: string;
  share: string;
  conversations: string;
  /** What the muted part of the composition bar is called. */
  rest: string;
}

export function LabelTable({
  rows,
  total,
  segments,
  split,
  previousLabel,
  present,
  composition,
  hints,
  emptyText,
}: {
  rows: LabelRow[];
  /** Every question in the period: the denominator of a share. */
  total: number;
  segments: readonly Segment[];
  split: boolean;
  /** The previous period's name for the delta column; null hides the column. */
  previousLabel: string | null;
  present: (key: string) => LabelPresentation;
  composition: CompositionPart[] | null;
  hints: LabelTableHints;
  emptyText: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.questions));
  const color = new Map(
    (composition ?? []).filter((c) => !c.muted).map((c, i) => [c.key, seriesColor(i)]),
  );
  return (
    <>
      {composition ? (
        <div className="flex flex-col gap-1.5 py-1">
          <div aria-hidden className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {composition.map((c) => (
              <div
                key={c.key}
                className={c.muted ? "h-full opacity-40" : "h-full"}
                style={{ width: `${c.share}%`, backgroundColor: color.get(c.key) ?? MUTED }}
              />
            ))}
          </div>
          <ul aria-label="Share of questions" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {composition.map((c) => (
              <li key={c.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={c.muted ? "size-2 rounded-full opacity-40" : "size-2 rounded-full"}
                  style={{ backgroundColor: color.get(c.key) ?? MUTED }}
                />
                <span className="text-muted-foreground">
                  {c.muted ? hints.rest : present(c.key).name}
                </span>
                <span className="tabular-nums">{c.share}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Hint hint={hints.label}>{hints.column}</Hint>
              </TableHead>
              <TableHead className="text-right">
                <Hint hint={hints.questions}>Questions</Hint>
              </TableHead>
              <TableHead className="text-right">
                <Hint hint={hints.share}>Share</Hint>
              </TableHead>
              {previousLabel ? (
                <TableHead className="hidden text-right sm:table-cell">
                  <Hint
                    hint={`Questions gained or lost against the ${previousLabel} before this period.`}
                  >
                    vs previous
                  </Hint>
                </TableHead>
              ) : null}
              <TableHead className="text-right">
                <Hint hint={hints.conversations}>Conversations</Hint>
              </TableHead>
              {split
                ? segments.map((s) => (
                    <TableHead key={s.id} className="hidden text-right lg:table-cell">
                      {s.label}
                    </TableHead>
                  ))
                : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const shown = row.key === null ? null : present(row.key);
              return (
                <TableRow key={row.key ?? "__unlabelled__"}>
                  <TableCell>
                    {row.key === null || !shown ? (
                      <span className="text-muted-foreground">Not yet labelled</span>
                    ) : (
                      <LabelName
                        name={shown.name}
                        href={shown.href}
                        description={shown.description}
                        swatch={
                          composition
                            ? { color: color.get(row.key) ?? MUTED, muted: !color.has(row.key) }
                            : null
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Bar
                      parts={
                        row.key === null
                          ? [{ key: "all", value: row.questions, color: MUTED }]
                          : split
                            ? [
                                ...segments.map((s, i) => ({
                                  key: s.id,
                                  value: row.perSegment.get(s.id) ?? 0,
                                  color: seriesColor(i),
                                })),
                                {
                                  key: "__other__",
                                  value: row.perSegment.get("__other__") ?? 0,
                                  color: MUTED,
                                },
                              ]
                            : [
                                {
                                  key: "all",
                                  value: row.questions,
                                  // The label's own colour when the composition bar names it.
                                  color: composition
                                    ? (color.get(row.key) ?? MUTED_SOFT)
                                    : seriesColor(0),
                                },
                              ]
                      }
                      max={max}
                      total={row.questions}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {percent(row.questions, total) ?? 0}%
                  </TableCell>
                  {previousLabel ? (
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      <Delta now={row.questions} before={row.before ?? 0} />
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">{row.conversations}</TableCell>
                  {split
                    ? segments.map((s) => (
                        <TableCell
                          key={s.id}
                          className="hidden text-right text-muted-foreground tabular-nums lg:table-cell"
                        >
                          {row.perSegment.get(s.id) ?? 0}
                        </TableCell>
                      ))
                    : null}
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5 + segments.length}
                  className="py-8 text-center text-muted-foreground"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function LabelName({
  name,
  href,
  description,
  swatch,
}: {
  name: string;
  href: string | null;
  description?: string;
  swatch: { color: string; muted: boolean } | null;
}) {
  const dot = swatch ? (
    <span
      aria-hidden
      className={
        swatch.muted ? "size-2 shrink-0 rounded-full opacity-40" : "size-2 shrink-0 rounded-full"
      }
      style={{ backgroundColor: swatch.color }}
    />
  ) : null;
  const className = "inline-flex items-center gap-2 font-medium underline-offset-4";
  return href ? (
    <Link href={href} title={description} className={`${className} hover:underline`}>
      {dot}
      {name}
    </Link>
  ) : (
    <span title={description} className={className}>
      {dot}
      {name}
    </span>
  );
}

/**
 * A number with its share of the column's largest value drawn beside it, so
 * a ranked table reads as a bar chart: one hue for one series, and the
 * chart's series colours, stacked with a surface gap, when the page is split.
 */
export function Bar({
  parts,
  max,
  total,
}: {
  parts: Array<{ key: string; value: number; color: string }>;
  max: number;
  total: number;
}) {
  const scale = max > 0 ? 100 / max : 0;
  return (
    <div className="flex items-center justify-end gap-3">
      <div
        aria-hidden
        className="flex h-2 w-24 shrink-0 justify-start gap-0.5 overflow-hidden rounded-full sm:w-32 lg:w-48"
      >
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <div
              key={part.key}
              className="h-full rounded-full"
              style={{ width: `${part.value * scale}%`, backgroundColor: part.color }}
            />
          ))}
      </div>
      <span className="w-8 text-right tabular-nums">{total}</span>
    </div>
  );
}

/**
 * A change with its direction and its size: the arrow says which way, the
 * count says how much, the percentage says how much that is. A label with
 * no questions before is "new", not an infinite percentage.
 */
export function Delta({ now, before }: { now: number; before: number }) {
  if (now === before) return <span className="text-muted-foreground">—</span>;
  if (before === 0) return <span className="text-muted-foreground">new</span>;
  const up = now > before;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <Arrow className="size-3.5 shrink-0" aria-hidden />
      <span>{deltaLabel(now, before)}</span>
      <span className="text-muted-foreground">
        {up ? "+" : "−"}
        {Math.round((Math.abs(now - before) / before) * 100)}%
      </span>
    </span>
  );
}
