import { describe, expect, it } from "vitest";
import { summarizeRetrieval } from "./summary";

describe("summarizeRetrieval", () => {
  it("reports zero hits and no scores for an empty set", () => {
    expect(summarizeRetrieval([])).toEqual({ hits: 0, topScore: null, meanScore: null });
  });

  it("takes the top score as the maximum, not the first", () => {
    // A reranked or fused list is not sorted by cosine; the first chunk is the
    // best-ranked, which is a different thing from the best-scored.
    const s = summarizeRetrieval([{ score: 0.4 }, { score: 0.9 }, { score: 0.5 }]);
    expect(s.hits).toBe(3);
    expect(s.topScore).toBe(0.9);
    expect(s.meanScore).toBeCloseTo(0.6);
  });

  it("leaves unscored chunks out of the averages but in the count", () => {
    const s = summarizeRetrieval([{ score: null }, { score: 0.8 }]);
    expect(s).toEqual({ hits: 2, topScore: 0.8, meanScore: 0.8 });
  });

  it("returns null scores when nothing was scored", () => {
    expect(summarizeRetrieval([{ score: null }])).toEqual({
      hits: 1,
      topScore: null,
      meanScore: null,
    });
  });
});
