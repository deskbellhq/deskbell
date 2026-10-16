import { describe, expect, it } from "vitest";
import { cleanSummary, SUMMARY_MAX_CHARS } from "./feedback-summarizer";

describe("cleanSummary", () => {
  it("takes the first non-empty line and strips quotes", () => {
    expect(cleanSummary('\n  "The answer named the wrong menu."  \nmore')).toBe(
      "The answer named the wrong menu.",
    );
  });
  it("returns empty for nothing usable and caps long output", () => {
    expect(cleanSummary("  \n\n")).toBe("");
    const long = cleanSummary("x".repeat(400));
    expect(long).toHaveLength(SUMMARY_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
