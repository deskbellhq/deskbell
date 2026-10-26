import { describe, expect, it, vi } from "vitest";

import {
  type AnswerSignal,
  classifyAnswer,
  GAPS_DEFAULTS,
  readGapsConfig,
  summarizeRetrieval,
} from "./gaps-signal";

function signal(over: Partial<AnswerSignal> = {}): AnswerSignal {
  return {
    refused: false,
    feedback: null,
    refusalReason: null,
    sourcesNamed: true,
    retrievalTopScore: 0.8,
    ...over,
  };
}

describe("classifyAnswer — unsupported terms (spec: answer-verification)", () => {
  it("is not a gap when unchecked or clean", () => {
    expect(classifyAnswer(signal()).isGap).toBe(false);
    expect(classifyAnswer(signal({ unsupportedTerms: null })).isGap).toBe(false);
    expect(classifyAnswer(signal({ unsupportedTerms: [] })).isGap).toBe(false);
  });

  it("is a gap of its own kind when the answer named something the corpus lacks", () => {
    const cls = classifyAnswer(signal({ unsupportedTerms: ["Find and Replace"] }));
    expect(cls).toMatchObject({
      kinds: ["unsupported_terms"],
      isGap: true,
      primary: "unsupported_terms",
    });
  });

  it("ignores the list on a refusal or a clarification — neither is checked", () => {
    const refused = classifyAnswer(
      signal({ refused: true, refusalReason: "no_grounding", unsupportedTerms: ["x"] }),
    );
    expect(refused.kinds).toEqual(["refused_with_context"]);
    const asked = classifyAnswer(signal({ clarified: true, unsupportedTerms: ["x"] }));
    expect(asked.isGap).toBe(false);
  });

  it("does not count a refusal for lack of access as a gap (spec: own-data-fallback)", () => {
    // The visitor asked about their own data; no page can hold it. A
    // refusal everywhere a refusal is shown, never a page to write.
    const cls = classifyAnswer(signal({ refused: true, refusalReason: "no_access" }));
    expect(cls.kinds).toEqual([]);
    expect(cls.isGap).toBe(false);
  });

  it("leads with marked down, then unsupported, then weak", () => {
    const cls = classifyAnswer(
      signal({ feedback: "down", unsupportedTerms: ["x"], retrievalTopScore: 0.1 }),
    );
    expect(cls.kinds).toEqual(["downvoted", "unsupported_terms", "weak_answer"]);
    expect(cls.primary).toBe("downvoted");
  });
});

describe("summarizeRetrieval", () => {
  it("is the core helper, re-exported so the route and the page agree", () => {
    expect(summarizeRetrieval([{ score: 0.2 }, { score: 0.6 }]).topScore).toBe(0.6);
  });
});

describe("readGapsConfig", () => {
  it("defaults when unset or blank", () => {
    expect(readGapsConfig({})).toEqual(GAPS_DEFAULTS);
    expect(readGapsConfig({ DESKBELL_GAPS_WEAK_SCORE: "  " })).toEqual(GAPS_DEFAULTS);
  });

  it("accepts a number in [0, 1)", () => {
    expect(readGapsConfig({ DESKBELL_GAPS_WEAK_SCORE: "0.42" })).toEqual({ weakScore: 0.42 });
    expect(readGapsConfig({ DESKBELL_GAPS_WEAK_SCORE: "0" })).toEqual({ weakScore: 0 });
  });

  it("warns and falls back on a malformed value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["1", "-0.1", "abc"]) {
      expect(readGapsConfig({ DESKBELL_GAPS_WEAK_SCORE: bad })).toEqual(GAPS_DEFAULTS);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe("classifyAnswer", () => {
  it("never marks a clarifying question weak or unsourced; a downvote on one still counts", () => {
    const asked = signal({ clarified: true, retrievalTopScore: 0.1, sourcesNamed: false });
    expect(classifyAnswer(asked)).toEqual({
      kinds: [],
      isGap: false,
      primary: null,
      unsourced: false,
    });
    expect(classifyAnswer({ ...asked, feedback: "down" }).primary).toBe("downvoted");
  });

  it("is not a gap for a well-evidenced, unflagged answer", () => {
    expect(classifyAnswer(signal())).toEqual({
      kinds: [],
      isGap: false,
      primary: null,
      unsourced: false,
    });
  });

  it("splits refusals by reason and leaves historical ones unsplit", () => {
    expect(classifyAnswer(signal({ refused: true, refusalReason: "no_context" })).primary).toBe(
      "refused_no_context",
    );
    expect(classifyAnswer(signal({ refused: true, refusalReason: "no_grounding" })).primary).toBe(
      "refused_with_context",
    );
    expect(classifyAnswer(signal({ refused: true, refusalReason: null })).primary).toBe("refused");
  });

  it("does not make a gap of a refusal the docs did not cause", () => {
    // `guardrail` is the engine-error path; `off_topic` is a question outside
    // the docs. The visitor saw a refusal, the gaps page must not.
    for (const refusalReason of ["guardrail", "off_topic"]) {
      const cls = classifyAnswer(signal({ refused: true, refusalReason }));
      expect(cls.isGap).toBe(false);
      expect(cls.kinds).toEqual([]);
    }
    // A thumbs-down on such a row still flags it: that signal is the visitor's.
    expect(
      classifyAnswer(signal({ refused: true, refusalReason: "guardrail", feedback: "down" })).kinds,
    ).toEqual(["downvoted"]);
  });

  it("flags a weak answer when the top score is under the floor", () => {
    expect(classifyAnswer(signal({ retrievalTopScore: 0.1 })).kinds).toEqual(["weak_answer"]);
    expect(classifyAnswer(signal({ retrievalTopScore: 0.1 }), { weakScore: 0.05 }).isGap).toBe(
      false,
    );
  });

  it("counts an answer that named no source without making it a gap", () => {
    // The common case with the shipped chat model — a gap flag here would
    // flag nearly every answer. Counted so the rate is visible instead.
    expect(classifyAnswer(signal({ sourcesNamed: false }))).toMatchObject({
      isGap: false,
      unsourced: true,
    });
    expect(classifyAnswer(signal({ refused: true, sourcesNamed: false })).unsourced).toBe(false);
  });

  it("never flags on a null: rows from before the columns existed classify as before", () => {
    const historical = signal({ sourcesNamed: null, retrievalTopScore: null });
    expect(classifyAnswer(historical).isGap).toBe(false);
    expect(classifyAnswer({ ...historical, feedback: "down" }).kinds).toEqual(["downvoted"]);
  });

  it("orders the badge refused, then marked down, then weak", () => {
    const all = signal({ refused: true, refusalReason: "no_grounding", feedback: "down" });
    expect(classifyAnswer(all).kinds).toEqual(["refused_with_context", "downvoted"]);
    // A refusal has no answer to be weak, whatever the score says.
    expect(classifyAnswer({ ...all, retrievalTopScore: 0 }).kinds).not.toContain("weak_answer");
    expect(classifyAnswer(signal({ feedback: "down", retrievalTopScore: 0.1 })).kinds).toEqual([
      "downvoted",
      "weak_answer",
    ]);
  });
});
