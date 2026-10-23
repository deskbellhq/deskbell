import { OTHER_TOPIC, topicName } from "@deskbell/shared";
import { Badge } from "@deskbell/ui/components/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@deskbell/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SiteHeader } from "@/components/site-header";
import { UsageChart } from "@/components/usage-chart";
import { UsageToolbar } from "@/components/usage-toolbar";
import { requireMember } from "@/lib/auth/session";
import { conversationsHref } from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { resolvePeriod } from "@/lib/gaps";
import { relativeTime } from "@/lib/inbox";
import { getDefaultProject } from "@/lib/org";
import {
  chartRange,
  deltaLabel,
  foldTotals,
  NO_SEGMENT,
  percent,
  pickSegments,
  type Segment,
  zeroFilledDays,
} from "@/lib/usage";
import { loadContextNames, loadUsage, type UsageTotals } from "@/lib/usage-query";
import { parseUsageView, type UsageView, usageHref, withFilter } from "@/lib/usage-view";

export const dynamic = "force-dynamic";

/**
 * Usage (spec: usage-page): how much the widget is used, by whom in the
 * aggregate, and about what. Every number is a count over visitor questions
 * in the period; the host page's context keys are the dimensions — any key a
 * conversation carries can split the numbers, list a breakdown, or filter.
 *
 * Nothing on this page names a person: visitors are counted as opaque ids
 * and the breakdown shows the ids and names the host page attached to the
 * conversation, never a visitor's own.
 */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, project, { role }] = await Promise.all([
    searchParams,
    getDefaultProject(),
    requireMember(),
  ]);
  const view = parseUsageView(params);
  const now = new Date();
  const period = resolvePeriod(view.period, now);
  const db = getDb();
  const [data, filterLabels] = await Promise.all([
    loadUsage(db, project, view, period, now),
    loadContextNames(db, project, view.filters),
  ]);

  const segments: Segment[] = view.split
    ? pickSegments(data.segments, view.split)
    : [{ id: NO_SEGMENT, label: "Questions" }];
  const empty = (segment: string): UsageTotals => ({
    segment,
    questions: 0,
    conversations: 0,
    visitors: 0,
    returning: 0,
  });
  const add = (into: UsageTotals, row: UsageTotals): UsageTotals => ({
    segment: into.segment,
    questions: into.questions + row.questions,
    conversations: into.conversations + row.conversations,
    visitors: into.visitors + row.visitors,
    returning: into.returning + row.returning,
  });
  const totals = foldTotals(data.totals, segments, add, empty);
  const previous = data.previousTotals
    ? foldTotals(data.previousTotals, segments, add, empty)
    : null;
  const sum = (rows: UsageTotals[] | null, field: keyof Omit<UsageTotals, "segment">) =>
    rows ? rows.reduce((n, r) => n + r[field], 0) : null;
  const chart = zeroFilledDays(data.days, chartRange(period.from, now), segments);
  const hasQuestions = (sum(totals, "questions") ?? 0) > 0;

  // Topics: one row per label, folded segments as columns, delta on the total.
  const topics = new Map<
    string | null,
    { questions: number; conversations: number; perSegment: Map<string, number> }
  >();
  for (const row of data.topics) {
    const entry = topics.get(row.topic) ?? {
      questions: 0,
      conversations: 0,
      perSegment: new Map(),
    };
    entry.questions += row.questions;
    entry.conversations += row.conversations;
    const id = segments.some((s) => s.id === row.segment) ? row.segment : "__other__";
    entry.perSegment.set(id, (entry.perSegment.get(id) ?? 0) + row.questions);
    topics.set(row.topic, entry);
  }
  const previousTopics = new Map(data.previousTopics?.map((t) => [t.topic, t.questions]) ?? []);
  const topicRows = [...topics.entries()]
    .map(([topic, t]) => ({ topic, ...t }))
    // Labelled first by size; the unlabelled row and Other sink to the bottom.
    .sort((a, b) => {
      const rank = (t: string | null) => (t === null ? 2 : t === OTHER_TOPIC ? 1 : 0);
      return rank(a.topic) - rank(b.topic) || b.questions - a.questions;
    });
  const canConfigure = role === "owner" || role === "admin";
  const splitLine = (field: keyof Omit<UsageTotals, "segment">) =>
    view.split && segments.length > 0
      ? totals.map((t, i) => `${segments[i]?.label}: ${t[field]}`).join(" · ")
      : null;

  const visitors = sum(totals, "visitors") ?? 0;
  const returning = sum(totals, "returning") ?? 0;
  const returningShare = percent(returning, visitors);
  const previousShare = previous
    ? percent(sum(previous, "returning") ?? 0, sum(previous, "visitors") ?? 0)
    : null;

  const cards = [
    {
      label: "Questions",
      value: sum(totals, "questions") ?? 0,
      before: sum(previous, "questions"),
      detail: "Visitor messages in the period",
      split: splitLine("questions"),
    },
    {
      label: "Conversations",
      value: sum(totals, "conversations") ?? 0,
      before: sum(previous, "conversations"),
      detail: "Threads with a question in the period",
      split: splitLine("conversations"),
    },
    {
      label: "Visitors",
      value: visitors,
      before: sum(previous, "visitors"),
      detail: "Signed-in people, or browser sessions when anonymous",
      split: splitLine("visitors"),
    },
    {
      label: "Returning visitors",
      value: returningShare === null ? "—" : `${returningShare}%`,
      before: null,
      beforeLabel:
        previousShare !== null && returningShare !== null
          ? deltaLabel(returningShare, previousShare).replace(/^([+-]\d+)$/, "$1 pts")
          : null,
      detail: `${returning} asked on more than one day`,
      split: splitLine("returning"),
    },
  ];

  return (
    <>
      <SiteHeader title="Usage" />
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <PageHeader
          title="Usage"
          description="Who asks, how much, and about what — counted over visitor questions, never over people by name."
        />
        <UsageToolbar view={view} keys={data.keys} filterLabels={filterLabels} />

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label} className="@container/card">
              <CardHeader>
                <dt className="text-sm text-muted-foreground">{card.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{card.value}</dd>
                {previous && (card.before !== null || card.beforeLabel) ? (
                  <Badge variant="outline" className="w-fit text-xs text-muted-foreground">
                    {card.beforeLabel ??
                      (card.before !== null
                        ? deltaLabel(Number(card.value), card.before)
                        : "")}{" "}
                    vs previous {PERIOD_LABEL[view.period]}
                  </Badge>
                ) : null}
                {card.split ? (
                  <p className="text-xs text-muted-foreground tabular-nums">{card.split}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{card.detail}</p>
                )}
              </CardHeader>
            </Card>
          ))}
        </dl>

        {hasQuestions ? (
          <UsageChart data={chart} segments={segments} filter={view.filters[0] ?? null} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No questions {PERIOD_SPAN[view.period]}</CardTitle>
              <CardDescription>
                {view.filters.length > 0
                  ? "Nothing matches these filters. Remove one, or widen the period."
                  : "Widen the period, or wait for the widget to be asked something."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {view.by ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              By {view.by}
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                {data.breakdown?.length ?? 0} {data.breakdown?.length === 1 ? "value" : "values"}
                {data.breakdownMissing > 0
                  ? ` · ${data.breakdownMissing} ${data.breakdownMissing === 1 ? "conversation" : "conversations"} without one`
                  : ""}
              </span>
            </h2>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view.by}</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Conversations</TableHead>
                    <TableHead className="text-right">Questions</TableHead>
                    <TableHead className="hidden md:table-cell">First seen</TableHead>
                    <TableHead className="hidden md:table-cell">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.breakdown ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={usageHref(
                            "/usage",
                            withFilter(view, { key: view.by ?? "", id: row.id }),
                          )}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.name ?? row.id}
                        </Link>
                        {row.name ? (
                          <span className="ml-2 text-xs text-muted-foreground">{row.id}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.visitors}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.conversations}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.questions}</TableCell>
                      <TableCell
                        className="hidden text-muted-foreground md:table-cell"
                        suppressHydrationWarning
                      >
                        {relativeTime(row.firstSeen)}
                      </TableCell>
                      <TableCell
                        className="hidden text-muted-foreground md:table-cell"
                        suppressHydrationWarning
                      >
                        {relativeTime(row.lastSeen)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(data.breakdown ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No conversation {PERIOD_SPAN[view.period]} carries {view.by}.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Topics</h2>
          {project.topics.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Questions are not grouped yet</CardTitle>
                <CardDescription>
                  {canConfigure ? (
                    <>
                      Name the topics visitors ask about under{" "}
                      <Link href="/settings/topics" className="underline underline-offset-4">
                        Settings › Topics
                      </Link>
                      , and each question is labelled with one as it comes in.
                    </>
                  ) : (
                    <>
                      An admin can name the topics under Settings › Topics; each question is then
                      labelled with one as it comes in.
                    </>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead className="text-right">Questions</TableHead>
                    {previous ? (
                      <TableHead className="hidden text-right sm:table-cell">vs previous</TableHead>
                    ) : null}
                    <TableHead className="text-right">Conversations</TableHead>
                    {view.split
                      ? segments.map((s) => (
                          <TableHead key={s.id} className="hidden text-right lg:table-cell">
                            {s.label}
                          </TableHead>
                        ))
                      : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topicRows.map((row) => (
                    <TableRow key={row.topic ?? "__unlabelled__"}>
                      <TableCell>
                        {row.topic === null ? (
                          <span className="text-muted-foreground">Not yet labelled</span>
                        ) : (
                          <Link
                            href={conversationsHref("/conversations", {
                              filter: "all",
                              period: view.period,
                              from: null,
                              to: null,
                              topic: row.topic,
                              context: view.filters[0] ?? null,
                            })}
                            title={project.topics.find((t) => t.key === row.topic)?.description}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {topicName(project.topics, row.topic)}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.questions}</TableCell>
                      {previous ? (
                        <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                          {deltaLabel(row.questions, previousTopics.get(row.topic) ?? 0)}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">{row.conversations}</TableCell>
                      {view.split
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
                  ))}
                  {topicRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4 + segments.length}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No questions {PERIOD_SPAN[view.period]}.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

const PERIOD_LABEL: Record<UsageView["period"], string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "period",
};

const PERIOD_SPAN: Record<UsageView["period"], string> = {
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  all: "yet",
};
