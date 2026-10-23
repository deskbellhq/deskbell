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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@deskbell/ui/components/toggle-group";
import { useIsMobile } from "@deskbell/ui/hooks/use-mobile";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { segmentPath } from "@/lib/column-segment";
import { conversationsHref } from "@/lib/conversations-view";

export const description = "Answers per day — certain vs uncertain";

export interface ChartPoint {
  /** YYYY-MM-DD, one row per day, oldest first, zero-filled server-side. */
  date: string;
  /** Answers neither refused nor weakly grounded (lib/thread-status.ts). */
  certain: number;
  /** Answers that refused or were written from retrieval under the weak floor. */
  uncertain: number;
}

/**
 * One hue plus grey, not a categorical pair: certain wears the bell's green,
 * uncertain a grey, so the emphasis sits on the grounded answers and a gap
 * reads as quiet space. The values are the theme's --certain/--uncertain
 * tokens, the same ones the thread badge and the inbox dot wear, so the
 * chart and the table under it cannot disagree on a colour.
 */
const chartConfig = {
  answers: {
    label: "Answers",
  },
  certain: {
    label: "Certain",
    color: "var(--certain)",
  },
  uncertain: {
    label: "Uncertain",
    color: "var(--uncertain)",
  },
} satisfies ChartConfig;

/** Surface gap between the two segments of a stack, and the rounded top. */
const SEGMENT_GAP = 2;
const TOP_RADIUS = 4;

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: ChartPoint;
}

/**
 * A column is a stack of two segments: uncertain at the baseline, certain on
 * top. Whichever segment is topmost gets the rounded top, and the upper one
 * gives up two pixels at its foot so the surface separates the two colours
 * (lib/column-segment.ts).
 */
function segment(series: "certain" | "uncertain") {
  return function Segment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
    if (!payload) return null;
    const d = segmentPath(
      { x, y, width, height },
      {
        topmost: series === "certain" || payload.certain === 0,
        trim: series === "certain" && payload.uncertain > 0 ? SEGMENT_GAP : 0,
        radius: TOP_RADIUS,
      },
    );
    return d ? <path d={d} fill={fill} /> : null;
  };
}

const CertainSegment = segment("certain");
const UncertainSegment = segment("uncertain");

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function AnswersChart({ data }: { data: ChartPoint[] }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [timeRange, setTimeRange] = React.useState("90d");

  // A column is a door (spec: chart-day-drilldown): it opens the
  // conversations with a message on that day, in the same UTC bucket.
  const openDay = React.useCallback(
    (item: { payload?: ChartPoint }) => {
      const date = item.payload?.date;
      if (date)
        router.push(
          conversationsHref("/conversations", {
            filter: "all",
            period: "custom",
            from: date,
            to: date,
            topic: null,
            context: null,
          }),
        );
    },
    [router],
  );

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d");
    }
  }, [isMobile]);

  // One row per day, oldest first — range selection is a slice, no clock math
  // (hydration-safe: server render and hydration always agree).
  const days = timeRange === "30d" ? 30 : timeRange === "7d" ? 7 : 90;
  const filteredData = data.slice(-days);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Answers</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Certain vs uncertain for the last 3 months
          </span>
          <span className="@[540px]/card:hidden">Certain vs uncertain</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          {/* Columns, not a curve: most days are quiet, and a smoothed area
              spreads one busy day over its empty neighbours. */}
          <BarChart
            data={filteredData}
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
            {/* A quiet scale so a spike reads as a count. */}
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
                    const point = items[0]?.payload as ChartPoint | undefined;
                    const total = point ? point.certain + point.uncertain : 0;
                    const label = `${shortDate(String(value))} · ${total} ${total === 1 ? "answer" : "answers"}`;
                    return total > 0 ? `${label} · click to open` : label;
                  }}
                  indicator="dot"
                />
              }
            />
            <Bar
              dataKey="uncertain"
              stackId="a"
              fill="var(--color-uncertain)"
              shape={UncertainSegment}
              onClick={openDay}
            />
            <Bar
              dataKey="certain"
              stackId="a"
              fill="var(--color-certain)"
              shape={CertainSegment}
              onClick={openDay}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
