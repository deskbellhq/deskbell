import { describe, expect, it } from "vitest";
import type { EvalCase, TargetAnswer } from "../types";
import { createDeterministicJudge, normalizeForMatch } from "./deterministic";
import { judgeName } from "./llm";

const judge = createDeterministicJudge();

const answer = (text: string, refused = false): TargetAnswer => ({
  answer: text,
  refused,
  citedDocumentIds: [],
  retrieved: [],
  usage: { input: 0, output: 0, embedding: 0 },
  latencyMs: 0,
});

const kase = (facts: string[], keyFact?: string): EvalCase => ({
  id: "c",
  question: "q",
  kind: "answerable",
  expectedFacts: facts,
  ...(keyFact ? { keyFact } : {}),
});

describe("createDeterministicJudge", () => {
  it("awards an A when every required fact is present", async () => {
    const v = await judge.grade(kase(["alpha", "beta"]), answer("alpha and beta are both here"));
    expect(v.grade).toBe("A");
    expect(v.missingFacts).toEqual([]);
  });

  it("awards a B when the key fact is present but supporting detail is missing", async () => {
    const v = await judge.grade(kase(["alpha", "beta"], "alpha"), answer("only alpha here"));
    expect(v.grade).toBe("B");
    expect(v.missingFacts).toEqual(["beta"]);
  });

  it("awards a C when the key fact is absent, however much else matched", async () => {
    // Partial credit is for an incomplete answer, not for a wrong one.
    const v = await judge.grade(kase(["alpha", "beta"], "alpha"), answer("beta only"));
    expect(v.grade).toBe("C");
  });

  it("awards a C to a refusal, since an answerable question went unanswered", async () => {
    const v = await judge.grade(kase(["alpha"]), answer("", true));
    expect(v.grade).toBe("C");
    expect(v.missingFacts).toEqual(["alpha"]);
  });

  it("matches case-insensitively and across reflowed whitespace", async () => {
    // Answers wrap differently run to run; a fact spanning a line break is the
    // same fact and must not be scored as missing.
    const v = await judge.grade(
      kase(["Postgres is the only dependency"]),
      answer("postgres is  the\n  only dependency."),
    );
    expect(v.grade).toBe("A");
  });

  it("keeps punctuation, so identifiers stay matchable", () => {
    // Criteria routinely quote things like ::part(panel) or an env var name;
    // stripping punctuation would make them unmatchable.
    expect(normalizeForMatch("Use `::part(panel)`")).toBe("use `::part(panel)`");
  });

  it("never claims groundedness — a substring match cannot see invention", async () => {
    const v = await judge.grade(kase(["alpha"]), answer("alpha, plus something invented"));
    expect(v.grounded).toBeNull();
  });
});

describe("judgeName", () => {
  it("marks a judge that is grading its own model", async () => {
    // The caveat rides in the NAME because the name is what reaches the report,
    // the baseline, and anything quoted out of them. A self-graded number must
    // never travel without it.
    expect(
      judgeName({ modelId: "openai/x", targetModelId: "openai/x", complete: async () => "" }),
    ).toBe("llm:openai/x (self-graded)");
  });

  it("leaves an independent judge unmarked", () => {
    expect(
      judgeName({ modelId: "openai/a", targetModelId: "openai/b", complete: async () => "" }),
    ).toBe("llm:openai/a");
  });

  it("does not claim self-grading when the target model is unknown", () => {
    expect(judgeName({ modelId: "openai/a", complete: async () => "" })).toBe("llm:openai/a");
  });
});
