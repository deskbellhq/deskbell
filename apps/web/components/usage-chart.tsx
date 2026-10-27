"use client";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deskbell/ui/components/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@deskbell/ui/components/chart";
import { ToggleGroup, ToggleGroupItem } from "@deskbell/ui/components/toggle-group";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { segmentPath } from "@/lib/column-segment";
import { conversationsHref } from "@/lib/conversations-view";
import { type ChartRow, type Segment, seriesKey, shiftUtcDay, weeklyRows } from "@/lib/usage";
import type { UsageFilter } from "@/lib/usage-view";

/**
 * Questions per day, one stacked column per day, one segment per series
 * (spec: usage-page). The series wear the theme's six categorical tokens in
 * their fixed order, largest series first at the baseline; a lone series
 * wears the first. Weekly is a roll-up of the same rows, done here, so the
 * toggle costs no request. A column is a door: it opens the conversations
 * with a message that day (or week), carrying the page's first filter.
 */
const SEGMENT_GAP = 2;
const TOP_RADIUS = 4;

interface Shape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: ChartRow;
}

const shortDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function UsageChart({
  data,
  segments,
  filter,
}: {
  /** One row per day, oldest first, zero-filled server-side. */
  data: ChartRow[];
  /** The series, in the order they stack from the baseline. */
  segments: Segment[];
  /** The page's first context filter, carried into the conversations link. */
  filter: UsageFilter | null;
}) {
  const router = useRouter();
  const [unit, setUnit] = React.useState<"day" | "week">(data.length > 45 ? "week" : "day");
  const rows = unit === "week" ? weeklyRows(data) : data;
  const keys = segments.map((_, i) => seriesKey(i));

  const config = Object.fromEntries(
    segments.map((s, i) => [
      seriesKey(i),
      { label: s.label, color: `var(--series-${(i % 6) + 1})` },
    ]),
  ) satisfies ChartConfig;

  const total = (row: ChartRow) => keys.reduce((sum, k) => sum + Number(row[k] ?? 0), 0);

  // The topmost non-empty segment of a column carries the rounded top; an
  // upper segment gives up two pixels at its foot (lib/column-segment.ts).
  const shape = (index: number) =>
    function Column({ x = 0, y = 0, width = 0, height = 0, fill, payload }: Shape) {
      if (!payload) return null;
      const above = keys.slice(index + 1).some((k) => Number(payload[k] ?? 0) > 0);
      const below = keys.slice(0, index).some((k) => Number(payload[k] ?? 0) > 0);
      const d = segmentPath(
        { x, y, width, height },
        { topmost: !above, trim: below ? SEGMENT_GAP : 0, radius: TOP_RADIUS },
      );
      return d ? <path d={d} fill={fill} /> : null;
    };
  const shapes = keys.map((_, i) => shape(i));

  const open = (item: { payload?: ChartRow }) => {
    const date = item.payload?.date;
    if (!date) return;
    router.push(
      conversationsHref("/conversations", {
        filter: "all",
        period: "custom",
        from: date,
        to: unit === "week" ? shiftUtcDay(date, 6) : date,
        topic: null,
        intent: null,
        signal: null,
        user: null,
        context: filter,
      }),
    );
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Questions</CardTitle>
        <CardDescription>{segments.length > 1 ? "Per day, by segment" : "Per day"}</CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={unit}
            onValueChange={(v) => v && setUnit(v as "day" | "week")}
            variant="outline"
            size="sm"
            aria-label="Unit"
          >
            <ToggleGroupItem value="day">Daily</ToggleGroupItem>
            <ToggleGroupItem value="week">Weekly</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
          <BarChart
            data={rows}
            barCategoryGap={1.5}
            maxBarSize={28}
            className="[&_.recharts-bar]:cursor-pointer"
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={shortDate}
            />
            <YAxis
              width={32}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickCount={4}
              allowDecimals={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value, items) => {
                    const row = items[0]?.payload as ChartRow | undefined;
                    const n = row ? total(row) : 0;
                    const when =
                      unit === "week"
                        ? `Week of ${shortDate(String(value))}`
                        : shortDate(String(value));
                    const label = `${when} · ${n} ${n === 1 ? "question" : "questions"}`;
                    return n > 0 ? `${label} · click to open` : label;
                  }}
                  indicator="dot"
                />
              }
            />
            {keys.map((key, i) => (
              <Bar
                key={`${key}-${unit}`}
                dataKey={key}
                stackId="a"
                fill={`var(--color-${key})`}
                shape={shapes[i]}
                onClick={open}
              />
            ))}
            {segments.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
