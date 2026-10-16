import { describe, expect, it } from "vitest";

import { refusalLabel, retrievalSummary } from "./refusal-label";

describe("refusalLabel", () => {
  it("names each recorded reason and defaults the rest", () => {
    expect(refusalLabel("no_context")).toBe("Nothing retrieved");
    expect(refusalLabel("no_grounding")).toBe("No grounded answer");
    expect(refusalLabel("off_topic")).toBe("Off topic");
    expect(refusalLabel("guardrail")).toBe("Blocked by guardrail");
    expect(refusalLabel(null)).toBe("No grounded answer");
    expect(refusalLabel("something_new")).toBe("No grounded answer");
  });
});

describe("retrievalSummary", () => {
  it("reads hits and the best score, and is null without either", () => {
    expect(retrievalSummary({ retrievalHits: 3, retrievalTopScore: 0.3123 })).toBe(
      "3 chunks, best 0.31",
    );
    expect(retrievalSummary({ retrievalHits: 1, retrievalTopScore: null })).toBe("1 chunk");
    expect(retrievalSummary({ retrievalHits: null, retrievalTopScore: 0.5 })).toBe("best 0.50");
    expect(retrievalSummary({ retrievalHits: null, retrievalTopScore: null })).toBeNull();
  });
});
