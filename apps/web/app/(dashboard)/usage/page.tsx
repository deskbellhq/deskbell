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
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SiteHeader } from "@/components/site-header";
import { UsageChart } from "@/components/usage-chart";
import { Hint, HintBadge, ShowAll } from "@/components/usage-hint";
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
  POWER_USER_DAYS,
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
 * Visitors are counted as opaque ids. The one place a person is named is the
 * visitors table, which lists every verified visitor the way the thread view
 * does; an anonymous browser session is counted and never listed.
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
  const topicMax = Math.max(0, ...topicRows.map((t) => t.questions));
  const topicTotal = topicRows.reduce((n, t) => n + t.questions, 0);

  // One sentence per table that says what the numbers mean, so the reader
  // does not have to find it: the leader, and what moved most.
  const named = topicRows.filter((t) => t.topic !== null && t.topic !== OTHER_TOPIC);
  const leader = named[0];
  const mover = previous
    ? named
        .map((t) => ({ t, gain: t.questions - (previousTopics.get(t.topic) ?? 0) }))
        .sort((a, b) => b.gain - a.gain)[0]
    : null;
  const lead = leader
    ? `${topicName(project.topics, leader.topic ?? "")} leads with ${percent(leader.questions, topicTotal) ?? 0}% of questions`
    : null;
  const topicsReading =
    project.topics.length > 0 && lead
      ? !mover || mover.gain <= 0
        ? `${lead}.`
        : mover.t.topic === leader?.topic
          ? `${lead} and grew most (+${mover.gain}).`
          : `${lead}; ${topicName(project.topics, mover.t.topic ?? "")} grew most (+${mover.gain}).`
      : null;
  // The share as a picture: the five largest named topics in the series
  // colours, everything else in one muted segment. Only when the page is
  // not split — split rows already wear the series colours per segment.
  const topFive = named.slice(0, 5);
  const topicColor = new Map(topFive.map((t, i) => [t.topic, seriesColor(i)]));
  const shown = topFive.reduce((n, t) => n + t.questions, 0);
  const composition =
    !view.split && topicTotal > 0
      ? [
          ...topFive.map((t) => ({
            key: t.topic ?? "",
            label: topicName(project.topics, t.topic ?? ""),
            share: percent(t.questions, topicTotal) ?? 0,
            color: topicColor.get(t.topic) ?? MUTED,
            muted: false,
          })),
          ...(topicTotal > shown
            ? [
                {
                  key: "__rest__",
                  label:
                    named.length > 5
                      ? "Other topics, Other and unlabelled"
                      : "Other and unlabelled",
                  share: percent(topicTotal - shown, topicTotal) ?? 0,
                  color: MUTED,
                  muted: true,
                },
              ]
            : []),
        ]
      : null;
  const top = data.visitors[0];
  const visitorsReading = top
    ? `${top.label} asks most (${top.questions} ${top.questions === 1 ? "question" : "questions"}); ${data.powerUsers} of ${data.identifiedVisitors} signed-in ${data.identifiedVisitors === 1 ? "visitor is a power user" : "visitors are power users"}, asking on ${POWER_USER_DAYS} or more days.`
    : null;
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
          description="Who asks, how much, and about what — counted over visitor questions in the period."
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
                    <Hint
                      hint={`The change against the ${PERIOD_LABEL[view.period]} before this period${card.label === "Returning visitors" ? ", in percentage points" : ""}.`}
                    >
                      {card.beforeLabel ??
                        (card.before !== null
                          ? deltaLabel(Number(card.value), card.before)
                          : "")}{" "}
                      vs previous {PERIOD_LABEL[view.period]}
                    </Hint>
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
                    <TableHead>
                      <Hint
                        hint={`One row per value of ${view.by} that a conversation in the period carries. The name is the latest one the host page sent with that id.`}
                      >
                        {view.by}
                      </Hint>
                    </TableHead>
                    <TableHead className="text-right">
                      <Hint hint="Distinct signed-in people or anonymous browser sessions who asked in a conversation carrying this value.">
                        Visitors
                      </Hint>
                    </TableHead>
                    <TableHead className="text-right">
                      <Hint hint="Threads carrying this value with at least one question in the period.">
                        Conversations
                      </Hint>
                    </TableHead>
                    <TableHead className="text-right">
                      <Hint hint="Visitor messages in those threads during the period.">
                        Questions
                      </Hint>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <Hint hint="The earliest question in the period under this value.">
                        First seen
                      </Hint>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <Hint hint="The latest question in the period under this value.">
                        Last seen
                      </Hint>
                    </TableHead>
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

        {data.visitors.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              Visitors
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                <Hint hint="Visitors the host page identified with a verified sign-in token. They are named the way the thread view names them.">
                  {data.visitors.length < data.identifiedVisitors
                    ? `first ${data.visitors.length} of ${data.identifiedVisitors} signed in`
                    : `${data.identifiedVisitors} signed in`}
                </Hint>
                {data.powerUsers > 0 ? (
                  <>
                    {" · "}
                    <Hint
                      hint={`Signed-in visitors who asked on ${POWER_USER_DAYS} or more different days of the period. Habit, not volume: one long afternoon does not qualify.`}
                    >
                      {data.powerUsers} power {data.powerUsers === 1 ? "user" : "users"}
                    </Hint>
                  </>
                ) : null}
                {data.anonymousVisitors > 0 ? (
                  <>
                    {" · "}
                    <Hint hint="Browser sessions without a sign-in token. They are counted in every number on this page but have no name to list.">
                      {data.anonymousVisitors} anonymous{" "}
                      {data.anonymousVisitors === 1 ? "session" : "sessions"} counted, not listed
                    </Hint>
                  </>
                ) : null}
              </span>
            </h2>
            {visitorsReading ? (
              <p className="text-sm text-muted-foreground">{visitorsReading}</p>
            ) : null}
            <div className="overflow-hidden rounded-lg border">
              <ShowAll total={data.visitors.length} shown={VISITORS_FOLD} noun="visitors">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Visitor</TableHead>
                      <TableHead className="text-right">
                        <Hint hint="Messages this visitor sent in the period. The bar is their share of the busiest visitor's count.">
                          Questions
                        </Hint>
                      </TableHead>
                      <TableHead className="text-right">
                        <Hint hint="Threads of theirs with at least one question in the period.">
                          Conversations
                        </Hint>
                      </TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        <Hint
                          hint={`Different days on which they asked. ${POWER_USER_DAYS} or more makes a power user.`}
                        >
                          Days active
                        </Hint>
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        <Hint hint="When their latest question in the period was asked.">
                          Last asked
                        </Hint>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.visitors.map((row, i) => (
                      <TableRow
                        key={row.id}
                        className={
                          i >= VISITORS_FOLD
                            ? "hidden group-data-[expanded=true]:table-row"
                            : undefined
                        }
                      >
                        <TableCell>
                          <Link
                            href={conversationsHref("/conversations", {
                              filter: "all",
                              period: view.period,
                              from: null,
                              to: null,
                              topic: null,
                              context: view.filters[0] ?? null,
                              user: row.id,
                            })}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {row.label}
                          </Link>
                          {row.email ? (
                            <span className="ml-2 text-xs text-muted-foreground">{row.email}</span>
                          ) : null}
                          {row.days >= POWER_USER_DAYS ? (
                            <span className="ml-2">
                              <HintBadge
                                hint={`Asked on ${row.days} different days of the period; ${POWER_USER_DAYS} or more makes a power user.`}
                              >
                                Power user
                              </HintBadge>
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Bar
                            parts={[{ key: "all", value: row.questions, color: seriesColor(0) }]}
                            max={data.visitors[0]?.questions ?? 0}
                            total={row.questions}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.conversations}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {row.days}
                        </TableCell>
                        <TableCell
                          className="hidden text-muted-foreground md:table-cell"
                          suppressHydrationWarning
                        >
                          {relativeTime(row.lastAsked)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ShowAll>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Topics</h2>
          {topicsReading ? <p className="text-sm text-muted-foreground">{topicsReading}</p> : null}
          {composition ? (
            <div className="flex flex-col gap-1.5 py-1">
              <div aria-hidden className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
                {composition.map((c) => (
                  <div
                    key={c.key}
                    className={c.muted ? "h-full opacity-40" : "h-full"}
                    style={{ width: `${c.share}%`, backgroundColor: c.color }}
                  />
                ))}
              </div>
              <ul
                aria-label="Share of questions"
                className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
              >
                {composition.map((c) => (
                  <li key={c.key} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={c.muted ? "size-2 rounded-full opacity-40" : "size-2 rounded-full"}
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="tabular-nums">{c.share}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
                    <TableHead>
                      <Hint hint="The label the chat model gave each question, from the list under Settings › Topics. Hover a topic for its description.">
                        Topic
                      </Hint>
                    </TableHead>
                    <TableHead className="text-right">
                      <Hint
                        hint={
                          view.split
                            ? "Visitor questions labelled with this topic in the period. The bar scales to the largest topic and stacks per series in the chart's colours."
                            : "Visitor questions labelled with this topic in the period. The bar scales to the largest topic."
                        }
                      >
                        Questions
                      </Hint>
                    </TableHead>
                    <TableHead className="text-right">
                      <Hint hint="This topic's percentage of every question in the period, including Other and the not-yet-labelled ones, so the column adds up to 100.">
                        Share
                      </Hint>
                    </TableHead>
                    {previous ? (
                      <TableHead className="hidden text-right sm:table-cell">
                        <Hint
                          hint={`Questions gained or lost against the ${PERIOD_LABEL[view.period]} before this period.`}
                        >
                          vs previous
                        </Hint>
                      </TableHead>
                    ) : null}
                    <TableHead className="text-right">
                      <Hint hint="Threads with at least one question on this topic in the period.">
                        Conversations
                      </Hint>
                    </TableHead>
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
                              user: null,
                            })}
                            title={project.topics.find((t) => t.key === row.topic)?.description}
                            className="inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                          >
                            {composition ? (
                              <span
                                aria-hidden
                                className={
                                  topicColor.has(row.topic)
                                    ? "size-2 shrink-0 rounded-full"
                                    : "size-2 shrink-0 rounded-full opacity-40"
                                }
                                style={{ backgroundColor: topicColor.get(row.topic) ?? MUTED }}
                              />
                            ) : null}
                            {topicName(project.topics, row.topic)}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <Bar
                          parts={
                            row.topic === null
                              ? [{ key: "all", value: row.questions, color: MUTED }]
                              : view.split
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
                                      // The topic's own colour when the composition bar names it.
                                      color: composition
                                        ? (topicColor.get(row.topic) ?? MUTED_SOFT)
                                        : seriesColor(0),
                                    },
                                  ]
                          }
                          max={topicMax}
                          total={row.questions}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(row.questions, topicTotal) ?? 0}%
                      </TableCell>
                      {previous ? (
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          <Delta now={row.questions} before={previousTopics.get(row.topic) ?? 0} />
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
                        colSpan={5 + segments.length}
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

/** Visitors shown before "Show all": enough to see who leads, not a wall. */
const VISITORS_FOLD = 10;

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

/**
 * A number with its share of the column's largest value drawn beside it, so
 * a ranked table reads as a bar chart: one hue for one series, and the
 * chart's series colours, stacked with a surface gap, when the page is split.
 */
function Bar({
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

const seriesColor = (i: number) => `var(--series-${(i % 6) + 1})`;
const MUTED = "var(--muted-foreground)";
const MUTED_SOFT = "color-mix(in oklab, var(--muted-foreground) 40%, transparent)";

/**
 * A change with its direction and its size: the arrow says which way, the
 * count says how much, the percentage says how much that is. A topic with
 * no questions before is "new", not an infinite percentage.
 */
function Delta({ now, before }: { now: number; before: number }) {
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
