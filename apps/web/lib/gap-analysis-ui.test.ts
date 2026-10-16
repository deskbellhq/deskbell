import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PENDING_TTL_MS,
  ANALYZE_ALL_CAP,
  type AnalysisCounts,
  type AnalysisRun,
  analysisCalloutView,
  analysisOutcome,
  analysisProgress,
  calloutPhase,
  failureCopy,
} from "./gap-analysis-ui";

const zero: AnalysisCounts = {
  analyzable: 0,
  pending: 0,
  analyzed: 0,
  failed: 0,
  budgetFailed: 0,
  stale: 0,
};
const counts = (over: Partial<AnalysisCounts>): AnalysisCounts => ({ ...zero, ...over });
const run = (over: Partial<AnalysisRun> = {}): AnalysisRun => ({
  requested: 3,
  pendingAtStart: 0,
  analyzedAtStart: 1,
  failedAtStart: 0,
  ...over,
});

describe("calloutPhase", () => {
  it("is requesting while the action runs, whatever the server says", () => {
    expect(calloutPhase({ isPending: true, pending: 0, run: run(), doneFlash: false })).toBe(
      "requesting",
    );
  });

  it("is running whenever the server reports pending requests", () => {
    expect(calloutPhase({ isPending: false, pending: 2, run: null, doneFlash: false })).toBe(
      "running",
    );
    expect(calloutPhase({ isPending: false, pending: 2, run: run(), doneFlash: true })).toBe(
      "running",
    );
  });

  it("is done only for the run this client started, while the flash lasts", () => {
    expect(calloutPhase({ isPending: false, pending: 0, run: run(), doneFlash: true })).toBe(
      "done",
    );
    expect(calloutPhase({ isPending: false, pending: 0, run: null, doneFlash: true })).toBe("idle");
    expect(calloutPhase({ isPending: false, pending: 0, run: run(), doneFlash: false })).toBe(
      "idle",
    );
  });
});

describe("analysisProgress", () => {
  it("counts down from what was requested plus what was already pending", () => {
    expect(analysisProgress(run({ requested: 3, pendingAtStart: 2 }), 5)).toEqual({
      done: 0,
      total: 5,
    });
    expect(analysisProgress(run({ requested: 3, pendingAtStart: 2 }), 1)).toEqual({
      done: 4,
      total: 5,
    });
  });

  it("clamps when the automatic rule adds requests mid-run or a request was skipped", () => {
    expect(analysisProgress(run({ requested: 3 }), 7)).toEqual({ done: 0, total: 3 });
    expect(analysisProgress(run({ requested: 3 }), 0)).toEqual({ done: 3, total: 3 });
  });
});

describe("analysisOutcome", () => {
  it("is the delta against the click-time baseline, never negative", () => {
    expect(analysisOutcome(run({ analyzedAtStart: 1, failedAtStart: 1 }), 6, 3)).toEqual({
      ready: 5,
      failed: 2,
    });
    expect(analysisOutcome(run({ analyzedAtStart: 4, failedAtStart: 2 }), 1, 0)).toEqual({
      ready: 0,
      failed: 0,
    });
  });
});

describe("analysisCalloutView", () => {
  it("hides only when there is nothing to offer, report or warn about", () => {
    expect(analysisCalloutView("idle", zero, null).hidden).toBe(true);
    expect(analysisCalloutView("idle", counts({ analyzable: 1 }), null).hidden).toBe(false);
    expect(analysisCalloutView("idle", counts({ failed: 1 }), null).hidden).toBe(false);
    expect(analysisCalloutView("idle", counts({ stale: 1 }), null).hidden).toBe(false);
  });

  it("offers the open clusters in view, capped per click", () => {
    const view = analysisCalloutView("idle", counts({ analyzable: 13 }), null);
    expect(view.icon).toBe("sparkles");
    expect(view.title).toBe("13 open clusters have no analysis yet");
    expect(view.detail).toContain(`up to ${ANALYZE_ALL_CAP} per click`);
    expect(view.button).toEqual({ label: "Analyze 13 open", busy: false });

    expect(analysisCalloutView("idle", counts({ analyzable: 33 }), null).button?.label).toBe(
      "Analyze 20 open",
    );
    expect(analysisCalloutView("idle", counts({ analyzable: 1 }), null).title).toBe(
      "1 open cluster has no analysis yet",
    );
  });

  it("reports failures first and still offers the rest", () => {
    const budget = analysisCalloutView(
      "idle",
      counts({ analyzable: 4, failed: 3, budgetFailed: 3 }),
      null,
    );
    expect(budget.icon).toBe("warning");
    expect(budget.title).toBe("3 analyses failed — daily token budget reached");
    expect(budget.detail).toContain("midnight UTC");
    expect(budget.button?.label).toBe("Analyze 4 open");

    const mixed = analysisCalloutView("idle", counts({ failed: 2, budgetFailed: 1 }), null);
    expect(mixed.title).toBe("2 analyses failed");
    expect(mixed.detail).toContain("Details");
    expect(mixed.button).toBeNull();

    expect(analysisCalloutView("idle", counts({ failed: 1 }), null).title).toBe(
      "1 analysis failed",
    );
  });

  it("warns about lost requests with the TTL in minutes", () => {
    const view = analysisCalloutView("idle", counts({ analyzable: 2, stale: 1 }), null);
    expect(view.detail).toMatch(/1 request has waited over 15 minutes .* worker is running\.$/);
    expect(ANALYSIS_PENDING_TTL_MS).toBe(15 * 60_000);

    const alone = analysisCalloutView("idle", counts({ stale: 2 }), null);
    expect(alone.icon).toBe("warning");
    expect(alone.detail).toContain("2 requests have waited");
    expect(alone.button).toBeNull();
  });

  it("confirms the click at once, with a busy button", () => {
    const view = analysisCalloutView("requesting", counts({ analyzable: 3 }), run());
    expect(view.icon).toBe("spinner");
    expect(view.title).toBe("Requesting analysis for 3 clusters…");
    expect(view.button).toEqual({ label: "Analyzing…", busy: true });
  });

  it("shows progress while running, only when it knows the baseline", () => {
    const known = analysisCalloutView("running", counts({ pending: 9 }), run({ requested: 13 }));
    expect(known.title).toBe("Analyzing 13 clusters… 4 of 13 done");
    expect(known.button).toBeNull();

    const unknown = analysisCalloutView("running", counts({ pending: 1 }), null);
    expect(unknown.title).toBe("Analyzing 1 cluster…");
    expect(unknown.icon).toBe("spinner");
  });

  it("reports what the run produced", () => {
    const ready = analysisCalloutView(
      "done",
      counts({ analyzed: 6, failed: 2 }),
      run({ analyzedAtStart: 1, failedAtStart: 0 }),
    );
    expect(ready.icon).toBe("check");
    expect(ready.title).toBe("5 analyses ready · 2 analyses failed");
    expect(ready.button).toBeNull();

    const clean = analysisCalloutView("done", counts({ analyzed: 2 }), run({ analyzedAtStart: 1 }));
    expect(clean.title).toBe("1 analysis ready");

    const failedOnly = analysisCalloutView("done", counts({ failed: 2 }), run());
    expect(failedOnly.icon).toBe("warning");
    expect(failedOnly.title).toBe("2 analyses failed");

    const nothing = analysisCalloutView("done", counts({ analyzed: 1 }), run());
    expect(nothing.title).toBe("No analyses written");
  });
});

describe("failureCopy", () => {
  it("names the budget refusal and how to get past it", () => {
    expect(failureCopy("budget")).toEqual({
      short: "Daily token budget reached",
      advice: expect.stringContaining("midnight UTC"),
    });
    expect(failureCopy("other")).toEqual({ short: "Analysis failed", advice: null });
  });
});
