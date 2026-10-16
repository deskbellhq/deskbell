import { describe, expect, it } from "vitest";

import { blanksSummary, type DraftFailureReason, draftFailureCopy } from "./answer-draft";

const REASONS: DraftFailureReason[] = ["budget", "forbidden", "missing", "model"];

describe("draftFailureCopy", () => {
  it("has a short line for every reason, and none of them ends in a full stop", () => {
    for (const reason of REASONS) {
      const copy = draftFailureCopy(reason);
      expect(copy.short.length).toBeGreaterThan(0);
      expect(copy.short.endsWith(".")).toBe(false);
    }
  });

  it("says when the budget resets, since that is the only way to wait it out", () => {
    expect(draftFailureCopy("budget").advice).toContain("midnight UTC");
  });

  it("passes a model's own message through as the advice, and falls back without one", () => {
    expect(draftFailureCopy("model", "model gpt-9 is not available").advice).toBe(
      "model gpt-9 is not available",
    );
    expect(draftFailureCopy("model").advice).toContain("write the answer yourself");
  });

  it("offers no advice where there is nothing the person can do about it", () => {
    expect(draftFailureCopy("forbidden").advice).toBeUndefined();
  });
});

describe("blanksSummary", () => {
  it("counts the blanks, singular and plural", () => {
    expect(blanksSummary(["the file format"])).toContain("1 blank to fill");
    expect(blanksSummary(["a", "b", "c"])).toContain("3 blanks to fill");
  });

  it("still asks for a check when the passages settled everything", () => {
    const summary = blanksSummary([]);
    expect(summary).not.toContain("blank");
    expect(summary).toContain("Check every fact");
  });
});
