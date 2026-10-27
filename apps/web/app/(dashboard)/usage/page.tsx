import {
  INTENT_INFO,
  intentName,
  isIntent,
  isSignal,
  OTHER_INTENT,
  OTHER_TOPIC,
  SIGNAL_INFO,
  signalName,
  topicName,
} from "@deskbell/shared";
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
import { Hint, HintBadge, ShowAll } from "@/components/usage-hint";
import { Bar, LabelTable, seriesColor } from "@/components/usage-label-table";
import { UsageToolbar } from "@/components/usage-toolbar";
import { requireMember } from "@/lib/auth/session";
import { type ConversationsView, conversationsHref } from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { resolvePeriod } from "@/lib/gaps";
import { relativeTime } from "@/lib/inbox";
import { getDefaultProject } from "@/lib/org";
import {
  chartRange,
  composition,
  deltaLabel,
  foldTotals,
  type LabelRow,
  labelRows,
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

  // One door for every label: the Conversations page narrowed to it, keeping
  // the period and the first context filter.
  const door = (narrowing: Partial<ConversationsView>) =>
    conversationsHref("/conversations", {
      filter: "all",
      period: view.period,
      from: null,
      to: null,
      topic: null,
      intent: null,
      signal: null,
      context: view.filters[0] ?? null,
      user: null,
      ...narrowing,
    });

  // Topics, intents and signals: the same table over three label lists
  // (spec: question-topics, intent-and-signals). Shares are of every question
  // in the period, so a column adds up to 100 and a signal's share reads as
  // "this many of all questions".
  const topicRows = labelRows(
    data.topics.map((r) => ({ key: r.topic, ...r })),
    segments,
    data.previousTopics?.map((t) => ({ key: t.topic, questions: t.questions })) ?? null,
    OTHER_TOPIC,
  );
  const intentRows = labelRows(data.intents, segments, data.previousIntents, OTHER_INTENT);
  const signalRows = labelRows(data.signals, segments, data.previousSignals, null);
  const questionTotal = sum(totals, "questions") ?? 0;
  const topicTotal = topicRows.reduce((n, t) => n + t.questions, 0);
  const named = (rows: LabelRow[], bucket: string) =>
    rows.filter((r) => r.key !== null && r.key !== bucket);

  // One sentence per table that says what the numbers mean, so the reader
  // does not have to find it: the leader, and what moved most.
  const namedTopics = named(topicRows, OTHER_TOPIC);
  const leader = namedTopics[0];
  const mover = previous
    ? namedTopics
        .map((t) => ({ t, gain: t.questions - (t.before ?? 0) }))
        .sort((a, b) => b.gain - a.gain)[0]
    : null;
  const lead = leader
    ? `${topicName(project.topics, leader.key ?? "")} leads with ${percent(leader.questions, topicTotal) ?? 0}% of questions`
    : null;
  const topicsReading =
    project.topics.length > 0 && lead
      ? !mover || mover.gain <= 0
        ? `${lead}.`
        : mover.t.key === leader?.key
          ? `${lead} and grew most (+${mover.gain}).`
          : `${lead}; ${topicName(project.topics, mover.t.key ?? "")} grew most (+${mover.gain}).`
      : null;

  // Intent: the leader, and the share of requests — the one intent that is a
  // product signal rather than a documentation one.
  const namedIntents = named(intentRows, OTHER_INTENT);
  const intentLeader = namedIntents[0];
  const requests = intentRows.find((r) => r.key === "request")?.questions ?? 0;
  const intentReading = intentLeader
    ? `${intentName(intentLeader.key ?? "")} leads with ${percent(intentLeader.questions, questionTotal) ?? 0}% of questions; ${requests === 0 ? "none asked" : `${percent(requests, questionTotal) ?? 0}% asked`} for something the product does not do.`
    : null;
  // Signals: the largest one, or the fact that there were none.
  const signalLeader = signalRows[0];
  const signalsReading = signalLeader
    ? `${signalName(signalLeader.key ?? "")} is the most common signal: ${signalLeader.questions} ${signalLeader.questions === 1 ? "question" : "questions"}, ${percent(signalLeader.questions, questionTotal) ?? 0}% of all.`
    : questionTotal > 0
      ? "No question carried a signal."
      : null;
  const labelled = intentRows.some((r) => r.key !== null);

  const topicsComposition = !view.split ? composition(topicRows, topicTotal, OTHER_TOPIC) : null;
  const intentComposition = !view.split
    ? composition(intentRows, questionTotal, OTHER_INTENT)
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
                            href={door({ user: row.id })}
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
            <LabelTable
              rows={topicRows}
              total={topicTotal}
              segments={segments}
              split={Boolean(view.split)}
              previousLabel={previous ? PERIOD_LABEL[view.period] : null}
              present={(key) => ({
                name: topicName(project.topics, key),
                description: project.topics.find((t) => t.key === key)?.description,
                href: door({ topic: key }),
              })}
              composition={topicsComposition}
              hints={{
                column: "Topic",
                label:
                  "The label the chat model gave each question, from the list under Settings › Topics. Hover a topic for its description.",
                questions: view.split
                  ? "Visitor questions labelled with this topic in the period. The bar scales to the largest topic and stacks per series in the chart's colours."
                  : "Visitor questions labelled with this topic in the period. The bar scales to the largest topic.",
                share:
                  "This topic's percentage of every question in the period, including Other and the not-yet-labelled ones, so the column adds up to 100.",
                conversations: "Threads with at least one question on this topic in the period.",
                rest:
                  namedTopics.length > 5
                    ? "Other topics, Other and unlabelled"
                    : "Other and unlabelled",
              }}
              emptyText={`No questions ${PERIOD_SPAN[view.period]}.`}
            />
          )}
        </section>

        {!project.classifyQuestions && !labelled ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Intent and signals</h2>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Questions are not labelled</CardTitle>
                <CardDescription>
                  {canConfigure ? (
                    <>
                      Labelling is switched off under{" "}
                      <Link href="/settings/topics" className="underline underline-offset-4">
                        Settings › Topics
                      </Link>
                      . Switch it on and each question gets an intent and signals as it comes in.
                    </>
                  ) : (
                    <>
                      An admin can switch labelling on under Settings › Topics; each question then
                      gets an intent and signals as it comes in.
                    </>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">
                Intent
                <span className="ml-2 font-normal text-muted-foreground">
                  <Hint hint="Why the visitor asked, one of six fixed intents the chat model picks for every question. Hover an intent for its rule.">
                    why they asked
                  </Hint>
                </span>
              </h2>
              {intentReading ? (
                <p className="text-sm text-muted-foreground">{intentReading}</p>
              ) : null}
              <LabelTable
                rows={intentRows}
                total={questionTotal}
                segments={segments}
                split={Boolean(view.split)}
                previousLabel={previous ? PERIOD_LABEL[view.period] : null}
                present={(key) => ({
                  name: intentName(key),
                  description: isIntent(key) ? INTENT_INFO[key].description : undefined,
                  href: isIntent(key) ? door({ intent: key }) : null,
                })}
                composition={intentComposition}
                hints={{
                  column: "Intent",
                  label:
                    "Why the visitor asked, as the chat model read it: one of six fixed intents. Hover an intent for its rule.",
                  questions: view.split
                    ? "Visitor questions with this intent in the period. The bar scales to the largest intent and stacks per series in the chart's colours."
                    : "Visitor questions with this intent in the period. The bar scales to the largest intent.",
                  share:
                    "This intent's percentage of every question in the period, including Other and the not-yet-labelled ones, so the column adds up to 100.",
                  conversations: "Threads with at least one question of this intent in the period.",
                  rest:
                    namedIntents.length > 5
                      ? "Other intents, Other and unlabelled"
                      : "Other and unlabelled",
                }}
                emptyText={`No questions ${PERIOD_SPAN[view.period]}.`}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">
                Signals
                <span className="ml-2 font-normal text-muted-foreground">
                  <Hint hint="How it went for the visitor: pushback against the previous answer, frustration, or asking for a person. A question can carry several, and most carry none.">
                    how it went
                  </Hint>
                </span>
              </h2>
              {signalsReading ? (
                <p className="text-sm text-muted-foreground">{signalsReading}</p>
              ) : null}
              <LabelTable
                rows={signalRows}
                total={questionTotal}
                segments={segments}
                split={Boolean(view.split)}
                previousLabel={previous ? PERIOD_LABEL[view.period] : null}
                present={(key) => ({
                  name: signalName(key),
                  description: isSignal(key) ? SIGNAL_INFO[key].description : undefined,
                  href: isSignal(key) ? door({ signal: key }) : null,
                })}
                composition={null}
                hints={{
                  column: "Signal",
                  label:
                    "What the chat model noticed about how the question went: one of three fixed signals. Hover a signal for its rule.",
                  questions: view.split
                    ? "Visitor questions carrying this signal in the period. A question with two signals counts under both. The bar scales to the largest signal and stacks per series."
                    : "Visitor questions carrying this signal in the period. A question with two signals counts under both. The bar scales to the largest signal.",
                  share:
                    "The percentage of every question in the period that carried this signal. Most questions carry none, so the column does not add up to 100.",
                  conversations:
                    "Threads with at least one question carrying this signal in the period.",
                  rest: "",
                }}
                emptyText={
                  questionTotal > 0
                    ? `No question ${PERIOD_SPAN[view.period]} carried a signal.`
                    : `No questions ${PERIOD_SPAN[view.period]}.`
                }
              />
            </section>
          </>
        )}
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
