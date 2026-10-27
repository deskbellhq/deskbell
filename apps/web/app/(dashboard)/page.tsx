import { modelProviderStatus } from "@deskbell/core/models";
import { conversations, messages } from "@deskbell/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { ActionsCard } from "@/components/actions-card";
import { AnswersChart, type ChartPoint } from "@/components/answers-chart";
import { type Conversation, DataTable } from "@/components/data-table";
import { GettingStarted } from "@/components/getting-started";
import { OnboardingLiveBanner } from "@/components/onboarding-live-banner";
import { PageHeader } from "@/components/page-header";
import { type OverviewStats, SectionCards } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";
import { abuseConfig } from "@/lib/abuse/config";
import { loadToolUsage, summarizeUsage } from "@/lib/actions/usage-query";
import { requireMember } from "@/lib/auth/session";
import { getPublicBaseUrl } from "@/lib/base-url";
import { countConversations } from "@/lib/conversations-list";
import { getDb } from "@/lib/db";
import { DEFAULT_PERIOD, groupGaps, resolvePeriod } from "@/lib/gaps";
import { loadGapRows } from "@/lib/gaps-query";
import { readGapsConfig } from "@/lib/gaps-signal";
import { getOnboardingDetails, getOnboardingStatus } from "@/lib/onboarding";
import { onboardingStage } from "@/lib/onboarding-stage";
import { getDefaultProject } from "@/lib/org";
import { threadStatus } from "@/lib/thread-status";

export const dynamic = "force-dynamic";

const ANSWER_PREVIEW_CHARS = 500;
const CHART_DAYS = 90;

/** The chart wants one row per day — fill the quiet days with zeros. */
function zeroFilledSeries(
  rows: { day: string; certain: number; uncertain: number }[],
): ChartPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series: ChartPoint[] = [];
  const today = new Date();
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    series.push({ date: key, certain: row?.certain ?? 0, uncertain: row?.uncertain ?? 0 });
  }
  return series;
}

export default async function Page() {
  // Both request-cached: requireMember already ran inside getDefaultProject.
  const [project, { role }] = await Promise.all([getDefaultProject(), requireMember()]);
  const onboarding = await getOnboardingStatus(project);

  // Until the widget is live on the operator's own site the Overview is the
  // guide, and nothing else (spec: overview-getting-started). The analytics
  // queries below never run for it, and it never runs theirs.
  if (!onboarding.complete && !onboarding.dismissed) {
    const [details, baseUrl] = await Promise.all([
      getOnboardingDetails(project),
      getPublicBaseUrl(),
    ]);
    const abuse = abuseConfig();
    return (
      <>
        <SiteHeader title="Overview" />
        <GettingStarted
          status={onboarding}
          details={details}
          stage={onboardingStage(onboarding)}
          baseUrl={baseUrl}
          projectKey={project.publicKey}
          role={role}
          providers={modelProviderStatus()}
          blockedWhenUnconfigured={abuse.isProduction && !abuse.allowAnyOrigin}
        />
      </>
    );
  }

  const db = getDb();
  const projectScope = and(
    eq(conversations.orgId, project.orgId),
    eq(conversations.projectId, project.id),
  );

  // The gaps count means what the gaps page shows at its default period:
  // gap groups with activity in the window, not raw refusals since the
  // beginning of time (spec: gaps-period-and-ordering).
  const gapsCfg = readGapsConfig();
  const gapsPeriod = resolvePeriod(DEFAULT_PERIOD, new Date());

  // An answer written from a best match under the weak floor — the gaps
  // page's "weak" class (lib/gaps-signal.ts isWeakAnswer), so the rows, the
  // chart and the answer rate agree with the gaps list on what is uncertain.
  // A refusal has no answer to be weak, and neither does a clarifying question.
  const isAssistant = sql`${messages.role} = 'assistant'`;
  const isWeak = sql`not ${messages.refused} and not ${messages.clarified} and ${messages.retrievalTopScore} is not null and ${messages.retrievalTopScore} < ${gapsCfg.weakScore}`;
  // Named something the documentation does not contain (spec: answer-verification).
  const isUnsupported = sql`coalesce(cardinality(${messages.unsupportedTerms}), 0) > 0`;
  const isUncertain = sql`(${messages.refused} or (${isWeak}) or (${isUnsupported}))`;

  // Actions this week; the card renders only when a tool actually ran.
  const usage7d = loadToolUsage(db, project, new Date(Date.now() - 7 * 86_400_000));
  const [recentRows, [convStats], [msgStats], seriesRows, gapRows, inbox] = await Promise.all([
    db
      .select({
        id: conversations.id,
        createdAt: conversations.createdAt,
        question: sql<
          string | null
        >`(array_agg(${messages.content} order by ${messages.createdAt}) filter (where ${messages.role} = 'user'))[1]`,
        // The row is titled by the first question, so the preview is the answer
        // to that question — not the latest one, which may be about something
        // else entirely (spec: sources-line-and-thread-status).
        answer: sql<
          string | null
        >`(array_agg(${messages.content} order by ${messages.createdAt}) filter (where ${messages.role} = 'assistant'))[1]`,
        answers: sql`count(*) filter (where ${messages.role} = 'assistant')`.mapWith(Number),
        refusals:
          sql`count(*) filter (where ${messages.role} = 'assistant' and ${messages.refused})`.mapWith(
            Number,
          ),
        weak: sql`count(*) filter (where ${isAssistant} and ${isWeak})`.mapWith(Number),
        unsupported: sql`count(*) filter (where ${isAssistant} and ${isUnsupported})`.mapWith(
          Number,
        ),
        turns: sql`count(*) filter (where ${messages.role} = 'user')`.mapWith(Number),
        feedback: sql<
          "up" | "down" | null
        >`(array_agg(${messages.feedback} order by ${messages.createdAt} desc) filter (where ${messages.feedback} is not null))[1]`,
        citations:
          sql`coalesce(sum(jsonb_array_length(${messages.citations})) filter (where ${messages.citations} is not null), 0)`.mapWith(
            Number,
          ),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversationId, conversations.id))
      .where(projectScope)
      .groupBy(conversations.id)
      .orderBy(desc(conversations.createdAt))
      .limit(10),
    db
      .select({
        total: count(),
        last7:
          sql`count(*) filter (where ${conversations.createdAt} >= now() - interval '7 days')`.mapWith(
            Number,
          ),
      })
      .from(conversations)
      .where(projectScope),
    db
      .select({
        questions: sql`count(*) filter (where ${messages.role} = 'user')`.mapWith(Number),
        questions7d:
          sql`count(*) filter (where ${messages.role} = 'user' and ${messages.createdAt} >= now() - interval '7 days')`.mapWith(
            Number,
          ),
        answers: sql`count(*) filter (where ${isAssistant})`.mapWith(Number),
        certain: sql`count(*) filter (where ${isAssistant} and not ${isUncertain})`.mapWith(Number),
        up: sql`count(*) filter (where ${messages.feedback} = 'up')`.mapWith(Number),
        down: sql`count(*) filter (where ${messages.feedback} = 'down')`.mapWith(Number),
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(projectScope),
    db
      .select({
        day: sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        // The chart speaks the thread badge's words (lib/thread-status.ts):
        // an answer is uncertain when it refused or was weakly grounded.
        // "Unanswered" is a thread without a reply and never a series here.
        certain: sql`count(*) filter (where ${isAssistant} and not ${isUncertain})`.mapWith(Number),
        uncertain: sql`count(*) filter (where ${isAssistant} and ${isUncertain})`.mapWith(Number),
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          projectScope,
          sql`${messages.createdAt} >= now() - interval '${sql.raw(String(CHART_DAYS))} days'`,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    loadGapRows(db, project, { from: gapsPeriod.from, to: null }, gapsCfg),
    // The same count the inbox's "Needs attention" view shows (spec: attention-inbox).
    countConversations(project, null),
  ]);

  const answersTotal = msgStats?.answers ?? 0;
  const stats: OverviewStats = {
    conversations: convStats?.total ?? 0,
    conversations7d: convStats?.last7 ?? 0,
    attention: inbox.attention,
    questions: msgStats?.questions ?? 0,
    questions7d: msgStats?.questions7d ?? 0,
    answerRate:
      answersTotal > 0 ? Math.round(((msgStats?.certain ?? 0) / answersTotal) * 100) : null,
    gaps: groupGaps(gapRows, gapsCfg).filter((g) => g.status !== "resolved").length,
    feedbackUp: msgStats?.up ?? 0,
    feedbackDown: msgStats?.down ?? 0,
  };

  const recent: Conversation[] = recentRows.map((row) => ({
    id: row.id,
    question: row.question ?? "(no user message)",
    channel: "widget",
    // Same rule as the Conversations sidebar: one uncertain answer marks the
    // thread. A thread whose first question was refused and second answered
    // must not read as certain under the first question's title.
    status: threadStatus(row),
    answer: row.answer
      ? row.answer.length > ANSWER_PREVIEW_CHARS
        ? `${row.answer.slice(0, ANSWER_PREVIEW_CHARS)}…`
        : row.answer
      : null,
    feedback: row.feedback ?? "none",
    citations: row.citations,
    turns: row.turns,
    refusals: row.refusals,
    weak: row.weak,
    unsupported: row.unsupported,
    date: row.createdAt.toISOString(),
  }));

  return (
    <>
      <SiteHeader title="Overview" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="px-4 lg:px-6">
              <PageHeader
                title="Overview"
                description="Questions, answer quality, and recent conversations for this project."
              />
            </div>
            {!onboarding.dismissed && (
              <div className="px-4 lg:px-6">
                <OnboardingLiveBanner status={onboarding} />
              </div>
            )}
            <SectionCards stats={stats} />
            <ActionsCard {...summarizeUsage(await usage7d)} />
            <div className="px-4 lg:px-6">
              <AnswersChart data={zeroFilledSeries(seriesRows)} />
            </div>
            <DataTable data={recent} />
          </div>
        </div>
      </div>
    </>
  );
}
