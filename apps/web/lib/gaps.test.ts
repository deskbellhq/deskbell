import { describe, expect, it } from "vitest";
import {
  ANALYSIS_PENDING_TTL_MS,
  attachTrend,
  classifyAnalysisFailure,
  countByStatus,
  filterByStatus,
  type GapRow,
  gapsHref,
  groupGaps,
  isAnalysisPending,
  normalizeQuestion,
  periodTotals,
  recencyWeight,
  resolvePeriod,
  resolveSort,
  resolveStatus,
  sortGroups,
  summarizeAnalysis,
} from "./gaps";
import { evalCaseSkeleton, FACT_PLACEHOLDER } from "./gaps-export";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 10, 12, minutes));

function row(over: Partial<GapRow> & { messageId: string }): GapRow {
  return {
    conversationId: `conv-${over.messageId}`,
    question: "How do I export?",
    refused: true,
    feedback: null,
    feedbackReason: null,
    feedbackComment: null,
    refusalReason: null,
    sourcesNamed: null,
    retrievalTopScore: null,
    citations: null,
    createdAt: at(0),
    gapClusterId: null,
    cluster: null,
    ...over,
  };
}

const doc = (documentId: string, title = documentId) => ({
  documentId,
  title,
  url: `https://docs.test/${documentId}`,
  snippet: "…",
});

describe("normalizeQuestion", () => {
  it("ignores case, spacing and trailing punctuation", () => {
    expect(normalizeQuestion("  How do I  Export?? ")).toBe("how do i export");
    expect(normalizeQuestion("how do i export.")).toBe("how do i export");
  });
});

describe("groupGaps", () => {
  it("groups the same question, keeps the first wording, counts and dates each", () => {
    const groups = groupGaps([
      row({ messageId: "m2", question: "how do i export", createdAt: at(5) }),
      row({ messageId: "m1", question: "How do I export?", createdAt: at(1) }),
      row({ messageId: "m3", question: "Where is billing?", createdAt: at(3) }),
    ]);
    expect(groups.map((g) => [g.question, g.count])).toEqual([
      ["How do I export?", 2],
      ["Where is billing?", 1],
    ]);
    expect(groups[0]).toMatchObject({
      firstSeen: at(1),
      lastSeen: at(5),
      latestMessageId: "m2",
      latestConversationId: "conv-m2",
    });
  });

  it("splits refusals from downvotes and keeps their evidence apart", () => {
    // A refusal's citations are what retrieval FOUND; a downvote's are what
    // the answer CITED. Blending them would hide which fix applies.
    const groups = groupGaps([
      row({ messageId: "r1", refused: true, citations: [doc("a"), doc("a"), doc("b")] }),
      row({
        messageId: "d1",
        refused: false,
        feedback: "down",
        feedbackReason: "incorrect",
        feedbackComment: "wrong page",
        citations: [doc("c")],
        createdAt: at(2),
      }),
    ]);
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g).toMatchObject({ count: 2, refusals: 1, downvotes: 1, reasons: { incorrect: 1 } });
    expect(g?.comments).toEqual(["wrong page"]);
    // Two chunks of one document are one document, counted once per message.
    expect(g?.found.map((e) => [e.documentId, e.count])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(g?.cited.map((e) => e.documentId)).toEqual(["c"]);
  });

  it("counts tool results per tool, not per call", () => {
    const call = (id: string) => ({
      documentId: `action:${id}`,
      title: "Look up your order",
      snippet: "",
      kind: "action",
    });
    const groups = groupGaps([
      row({
        messageId: "m1",
        question: "where is my order",
        refused: false,
        feedback: "down",
        citations: [call("a1"), doc("c")],
        createdAt: at(1),
      }),
      row({
        messageId: "m2",
        question: "where is my order",
        refused: false,
        feedback: "down",
        citations: [call("a2")],
        createdAt: at(2),
      }),
    ]);
    expect(groups[0]?.cited.map((e) => [e.documentId, e.title, e.count, e.kind])).toEqual([
      ["action:Look up your order", "Look up your order", 2, "action"],
      ["c", "c", 1, undefined],
    ]);
  });

  it("orders by frequency, then recency", () => {
    const groups = groupGaps([
      row({ messageId: "a", question: "old once", createdAt: at(1) }),
      row({ messageId: "b", question: "new once", createdAt: at(9) }),
      row({ messageId: "c", question: "twice", createdAt: at(2) }),
      row({ messageId: "d", question: "twice", createdAt: at(3) }),
    ]);
    expect(groups.map((g) => g.question)).toEqual(["twice", "new once", "old once"]);
  });

  it("groups by cluster when the worker assigned one, by text otherwise", () => {
    const cluster = {
      label: "How do I export?",
      status: "open" as const,
      resolvedAt: null,
      reopenedAt: null,
      embeddingModel: "m",
      analysis: null,
      analysisRequestedAt: null,
      analysisError: null,
      correctionDocumentId: null,
    };
    const groups = groupGaps([
      row({ messageId: "a", question: "Exporting — how?", gapClusterId: "gap_1", cluster }),
      row({ messageId: "b", question: "How do I export?", gapClusterId: "gap_1", cluster }),
      row({ messageId: "c", question: "How do I export?" }), // not assigned yet
    ]);
    expect(groups.map((g) => [g.key, g.count])).toEqual([
      ["cluster:gap_1", 2],
      ["key:how do i export", 1],
    ]);
    // The cluster's label, not the first phrasing; every phrasing kept.
    expect(groups[0]).toMatchObject({
      question: "How do I export?",
      clusterId: "gap_1",
      variants: ["Exporting — how?", "How do I export?"],
    });
  });

  it("groups by a caller-supplied key when given one", () => {
    // The seam a smarter grouping plugs into: same aggregation, different key.
    const groups = groupGaps(
      [
        row({ messageId: "a", question: "How do I export?" }),
        row({ messageId: "b", question: "Exporting — how?" }),
      ],
      undefined,
      () => "cluster-1",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "cluster-1", count: 2, question: "How do I export?" });
  });

  it("survives citations that no longer parse and messages without a question", () => {
    const groups = groupGaps([
      row({ messageId: "x", question: null, citations: [{ nope: true }] }),
    ]);
    expect(groups[0]).toMatchObject({ question: "(no user message)", found: [] });
  });
});

describe("evalCaseSkeleton", () => {
  it("emits a loadable answerable case carrying real-question provenance", () => {
    const [group] = groupGaps([
      row({ messageId: "m1", question: "How do I export a feed?", createdAt: at(4) }),
    ]);
    const parsed = JSON.parse(evalCaseSkeleton(group as NonNullable<typeof group>));
    expect(parsed).toMatchObject({
      id: expect.stringMatching(/^real-how-do-i-export-a-feed-[a-z0-9]{1,6}$/),
      question: "How do I export a feed?",
      kind: "answerable",
      expectedFacts: [FACT_PLACEHOLDER],
      relevantUrls: [],
      source: { kind: "real", messageId: "m1", capturedAt: at(4).toISOString() },
    });
  });
});

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 8, 10, 12, 0));
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

describe("resolvePeriod / resolveSort", () => {
  it("defaults to 30 days and 'recent', and falls back on garbage", () => {
    expect(resolvePeriod(undefined, NOW).key).toBe("30d");
    expect(resolvePeriod("yesterday", NOW).key).toBe("30d");
    expect(resolvePeriod(["7d", "90d"], NOW).key).toBe("7d");
    expect(resolveSort(undefined)).toBe("recent");
    expect(resolveSort("loudest")).toBe("recent");
    expect(resolveSort("trending")).toBe("trending");
  });

  it("derives the window and the equal-length window before it", () => {
    const p = resolvePeriod("7d", NOW);
    expect(p.from).toEqual(daysAgo(7));
    expect(p.previousFrom).toEqual(daysAgo(14));
    expect(resolvePeriod("all", NOW)).toEqual({ key: "all", from: null, previousFrom: null });
  });
});

describe("status (spec: gaps-status-filter)", () => {
  const open = { status: "open" as const };
  const resolved = { status: "resolved" as const };

  it("defaults to open and falls back on garbage", () => {
    expect(resolveStatus(undefined)).toBe("open");
    expect(resolveStatus("done")).toBe("open");
    expect(resolveStatus("resolved")).toBe("resolved");
    expect(resolveStatus(["all", "open"])).toBe("all");
  });

  it("filters by cluster status and counts every view", () => {
    const groups = [open, resolved, open];
    expect(filterByStatus(groups, "open")).toEqual([open, open]);
    expect(filterByStatus(groups, "resolved")).toEqual([resolved]);
    expect(filterByStatus(groups, "all")).toBe(groups);
    expect(countByStatus(groups)).toEqual({ open: 2, resolved: 1, all: 3 });
    expect(countByStatus([])).toEqual({ open: 0, resolved: 0, all: 0 });
  });

  it("builds one URL per view and leaves defaults out of it", () => {
    expect(gapsHref("/gaps", {})).toBe("/gaps");
    expect(gapsHref("/gaps", { period: "30d", sort: "recent", status: "open" })).toBe("/gaps");
    expect(gapsHref("/gaps", { period: "7d", sort: "frequent", status: "resolved" })).toBe(
      "/gaps?period=7d&sort=frequent&status=resolved",
    );
    expect(gapsHref("/gaps", { gap: "gap_1", write: true })).toBe("/gaps?gap=gap_1&write=1");
    expect(gapsHref("/gaps", { status: "all", gap: null, write: true })).toBe("/gaps?status=all");
  });
});

describe("recencyWeight", () => {
  it("halves every seven days and sums occurrences", () => {
    expect(recencyWeight([NOW], NOW)).toBe(1);
    expect(recencyWeight([daysAgo(7)], NOW)).toBeCloseTo(0.5);
    expect(recencyWeight([daysAgo(1), daysAgo(1)], NOW)).toBeCloseTo(1.81, 2);
    expect(recencyWeight([daysAgo(17), daysAgo(17)], NOW)).toBeCloseTo(0.37, 2);
  });
});

describe("sortGroups", () => {
  const period = resolvePeriod("30d", NOW);
  const build = (rows: GapRow[]) => attachTrend(groupGaps(rows), [], period, NOW);

  it("recent: a gap asked once today outranks one asked twice seventeen days ago", () => {
    // The observed defect: eleven twice-asked rows from three weeks earlier
    // sat above the one question refused today.
    const groups = build([
      row({ messageId: "a", question: "stale", createdAt: daysAgo(17) }),
      row({ messageId: "b", question: "stale", createdAt: daysAgo(17) }),
      row({ messageId: "c", question: "today", createdAt: NOW }),
    ]);
    expect(sortGroups(groups, "recent").map((g) => g.question)).toEqual(["today", "stale"]);
  });

  it("recent: a burst still wins — twice yesterday beats once today", () => {
    const groups = build([
      row({ messageId: "a", question: "burst", createdAt: daysAgo(1) }),
      row({ messageId: "b", question: "burst", createdAt: daysAgo(1) }),
      row({ messageId: "c", question: "today", createdAt: NOW }),
    ]);
    expect(sortGroups(groups, "recent").map((g) => g.question)).toEqual(["burst", "today"]);
  });

  it("frequent: count first, then most recent — the previous behaviour", () => {
    const groups = build([
      row({ messageId: "a", question: "stale", createdAt: daysAgo(17) }),
      row({ messageId: "b", question: "stale", createdAt: daysAgo(17) }),
      row({ messageId: "c", question: "today", createdAt: NOW }),
    ]);
    expect(sortGroups(groups, "frequent").map((g) => g.question)).toEqual(["stale", "today"]);
  });

  it("trending: the biggest rise against the previous window first", () => {
    const current = groupGaps([
      row({ messageId: "a", question: "steady", createdAt: daysAgo(2) }),
      row({ messageId: "b", question: "steady", createdAt: daysAgo(3) }),
      row({ messageId: "c", question: "rising", createdAt: daysAgo(1) }),
      row({ messageId: "d", question: "rising", createdAt: daysAgo(1) }),
    ]);
    const previous = groupGaps([
      row({ messageId: "p1", question: "steady", createdAt: daysAgo(40) }),
      row({ messageId: "p2", question: "steady", createdAt: daysAgo(41) }),
    ]);
    const groups = sortGroups(attachTrend(current, previous, period, NOW), "trending");
    expect(groups.map((g) => [g.question, g.trend])).toEqual([
      ["rising", "new"],
      ["steady", "flat"],
    ]);
  });
});

describe("sortGroups — resolved clusters sink", () => {
  it("keeps a resolved cluster below open ones in every order, for the view that shows both", () => {
    const period = resolvePeriod("30d", NOW);
    const resolved = {
      label: "Old news",
      status: "resolved" as const,
      resolvedAt: daysAgo(3),
      reopenedAt: null,
      embeddingModel: "m",
      analysis: null,
      analysisRequestedAt: null,
      analysisError: null,
      correctionDocumentId: null,
    };
    const groups = attachTrend(
      groupGaps([
        row({
          messageId: "r1",
          question: "Old news",
          gapClusterId: "gap_r",
          cluster: resolved,
          createdAt: NOW,
        }),
        row({
          messageId: "r2",
          question: "Old news",
          gapClusterId: "gap_r",
          cluster: resolved,
          createdAt: NOW,
        }),
        row({ messageId: "o1", question: "Open", createdAt: daysAgo(20) }),
      ]),
      [],
      period,
      NOW,
    );
    for (const sort of ["recent", "frequent", "trending"] as const) {
      expect(sortGroups(groups, sort).map((g) => g.question)).toEqual(["Open", "Old news"]);
    }
  });
});

describe("attachTrend", () => {
  const period = resolvePeriod("30d", NOW);
  const one = (q: string, n: number, id: string) =>
    Array.from({ length: n }, (_, i) =>
      row({ messageId: `${id}${i}`, question: q, createdAt: NOW }),
    );

  it("marks new, up, down and flat against the previous window", () => {
    const current = groupGaps([
      ...one("new", 1, "n"),
      ...one("up", 4, "u"),
      ...one("down", 1, "d"),
      ...one("flat", 4, "f"),
    ]);
    const previous = groupGaps([
      ...one("up", 2, "pu"),
      ...one("down", 4, "pd"),
      ...one("flat", 4, "pf"),
    ]);
    const byQ = Object.fromEntries(
      attachTrend(current, previous, period, NOW).map((g) => [
        g.question,
        [g.trend, g.previousCount],
      ]),
    );
    expect(byQ).toEqual({ new: ["new", 0], up: ["up", 2], down: ["down", 4], flat: ["flat", 4] });
  });

  it("has no trend at all-time, where there is no previous window", () => {
    const all = resolvePeriod("all", NOW);
    const [g] = attachTrend(groupGaps(one("q", 1, "x")), [], all, NOW);
    expect(g?.trend).toBeNull();
  });
});

describe("periodTotals", () => {
  it("sums groups, occurrences and each signal", () => {
    const groups = groupGaps([
      row({ messageId: "a", question: "q1" }),
      row({ messageId: "b", question: "q1", refused: false, feedback: "down" }),
      row({ messageId: "c", question: "q2", refused: false, retrievalTopScore: 0.1 }),
      row({ messageId: "d", question: "q2", refused: false, unsupportedTerms: ["Made Up"] }),
    ]);
    expect(periodTotals(groups)).toEqual({
      gaps: 2,
      occurrences: 4,
      refusals: 1,
      downvotes: 1,
      weak: 1,
      unsupported: 1,
    });
  });
});

describe("unsupported names (spec: answer-verification)", () => {
  it("counts answers and tallies each name once per answer, most used first", () => {
    const [g] = groupGaps([
      row({ messageId: "a", refused: false, unsupportedTerms: ["Find and Replace", "Merge"] }),
      row({ messageId: "b", refused: false, unsupportedTerms: ["Merge", "Merge"] }),
      // Checked clean and weak: a gap, but not an unsupported-name answer.
      row({ messageId: "d", refused: false, retrievalTopScore: 0.1, unsupportedTerms: [] }),
    ]);
    expect(g?.count).toBe(3);
    expect(g?.unsupported).toBe(2);
    expect(g?.unsupportedTerms).toEqual([
      { term: "Merge", count: 2 },
      { term: "Find and Replace", count: 1 },
    ]);
    expect(g?.weak).toBe(1);
  });

  it("ignores the names on a refused row — a refusal was never checked", () => {
    const [g] = groupGaps([row({ messageId: "a", unsupportedTerms: ["x"] })]);
    expect(g?.unsupported).toBe(0);
    expect(g?.unsupportedTerms).toEqual([]);
  });
});

describe("analysis requests (spec: gap-analysis-feedback)", () => {
  const CLOCK = at(30);
  const requested = (minutesAgo: number) => new Date(CLOCK.getTime() - minutesAgo * 60_000);
  const cluster = (over: Partial<NonNullable<GapRow["cluster"]>> = {}) => ({
    label: "How do I export?",
    status: "open" as const,
    resolvedAt: null,
    reopenedAt: null,
    embeddingModel: "m",
    analysis: null,
    analysisRequestedAt: null,
    analysisError: null,
    correctionDocumentId: null,
    ...over,
  });

  it("treats a request as pending until the TTL, then as lost", () => {
    expect(isAnalysisPending(null, CLOCK)).toBe(false);
    expect(isAnalysisPending(requested(1), CLOCK)).toBe(true);
    expect(isAnalysisPending(new Date(CLOCK.getTime() - ANALYSIS_PENDING_TTL_MS + 1), CLOCK)).toBe(
      true,
    );
    expect(isAnalysisPending(new Date(CLOCK.getTime() - ANALYSIS_PENDING_TTL_MS), CLOCK)).toBe(
      false,
    );
    expect(isAnalysisPending(requested(20), CLOCK)).toBe(false);
    // A clock ahead of the server's is still a live request.
    expect(isAnalysisPending(requested(-5), CLOCK)).toBe(true);
  });

  it("tells a budget refusal from a model failure", () => {
    expect(classifyAnalysisFailure(null)).toBeNull();
    expect(classifyAnalysisFailure("daily token budget reached — analysis skipped")).toEqual({
      kind: "budget",
      message: "daily token budget reached — analysis skipped",
    });
    expect(classifyAnalysisFailure("timeout")).toEqual({ kind: "other", message: "timeout" });
  });

  it("carries the request time and hides a stale error behind a live request", () => {
    const [live] = groupGaps(
      [
        row({
          messageId: "a",
          gapClusterId: "gap_live",
          cluster: cluster({ analysisRequestedAt: requested(1), analysisError: "timeout" }),
        }),
      ],
      undefined,
      undefined,
      CLOCK,
    );
    expect(live).toMatchObject({
      analysisRequestedAt: requested(1),
      analysisPending: true,
      analysisError: "timeout",
      analysisFailure: null,
    });

    const [lost] = groupGaps(
      [
        row({
          messageId: "b",
          gapClusterId: "gap_lost",
          cluster: cluster({ analysisRequestedAt: requested(20), analysisError: "timeout" }),
        }),
      ],
      undefined,
      undefined,
      CLOCK,
    );
    expect(lost).toMatchObject({
      analysisPending: false,
      analysisFailure: { kind: "other", message: "timeout" },
    });
  });

  it("counts what one click would send, what is running, what came back and what failed", () => {
    const analysis = {
      title: "t",
      finding: "f",
      recommendation: "r",
      suggestedFacts: [],
      model: "m",
      analyzedAt: CLOCK.toISOString(),
      inputHash: "h",
    };
    const groups = groupGaps(
      [
        row({ messageId: "open", question: "open", gapClusterId: "c_open", cluster: cluster() }),
        row({
          messageId: "pending",
          question: "pending",
          gapClusterId: "c_pending",
          cluster: cluster({ analysisRequestedAt: requested(1) }),
        }),
        row({
          messageId: "stale",
          question: "stale",
          gapClusterId: "c_stale",
          cluster: cluster({ analysisRequestedAt: requested(20) }),
        }),
        row({
          messageId: "done",
          question: "done",
          gapClusterId: "c_done",
          cluster: cluster({ analysis }),
        }),
        row({
          messageId: "budget",
          question: "budget",
          gapClusterId: "c_budget",
          cluster: cluster({ analysisError: "daily token budget reached — analysis skipped" }),
        }),
        row({
          messageId: "resolved",
          question: "resolved",
          gapClusterId: "c_resolved",
          cluster: cluster({ status: "resolved" }),
        }),
        row({ messageId: "unclustered", question: "unclustered" }),
      ],
      undefined,
      undefined,
      CLOCK,
    );
    const summary = summarizeAnalysis(groups);
    // Table order; the stale and the failed clusters are offered again.
    expect(summary.analyzableIds).toEqual(["c_open", "c_stale", "c_budget"]);
    expect(summary.counts).toEqual({
      analyzable: 3,
      pending: 1,
      analyzed: 1,
      failed: 1,
      budgetFailed: 1,
      stale: 1,
    });
  });
});
