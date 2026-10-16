import { describe, expect, it } from "vitest";
import { describeBalance, parseDataset, splitByKind } from "./dataset";

const valid = {
  name: "t",
  cases: [
    { id: "a", question: "q1", kind: "answerable", expectedFacts: ["fact"] },
    { id: "b", question: "q2", kind: "unanswerable" },
  ],
};

describe("parseDataset", () => {
  it("accepts a well-formed set", () => {
    expect(parseDataset(valid).cases).toHaveLength(2);
  });

  it("rejects an answerable case with no marking criteria", () => {
    // Without criteria there is nothing to grade against, and the case would
    // silently score whatever the judge felt like.
    expect(() =>
      parseDataset({ ...valid, cases: [{ id: "a", question: "q", kind: "answerable" }] }),
    ).toThrow(/expectedFacts/);
  });

  it("accepts prior turns on a follow-up case, and rejects empty or endless ones", () => {
    // A follow-up is asked in its thread (spec: answer-verification).
    const history = [
      { role: "user", content: "How do I move the launcher?" },
      { role: "assistant", content: "Use the position attribute." },
    ];
    const parsed = parseDataset({
      ...valid,
      cases: [{ ...valid.cases[0], history }],
    });
    expect(parsed.cases[0]?.history).toEqual(history);
    expect(() =>
      parseDataset({
        ...valid,
        cases: [{ ...valid.cases[0], history: [{ role: "user", content: "" }] }],
      }),
    ).toThrow(/history/);
    expect(() =>
      parseDataset({
        ...valid,
        cases: [{ ...valid.cases[0], history: Array(7).fill(history[0]) }],
      }),
    ).toThrow(/history/);
  });

  it("rejects an unanswerable case that carries criteria", () => {
    // It is scored on refusing. Facts on it mean the author picked the wrong kind.
    expect(() =>
      parseDataset({
        ...valid,
        cases: [{ id: "a", question: "q", kind: "unanswerable", expectedFacts: ["x"] }],
      }),
    ).toThrow(/unanswerable/);
  });

  it("rejects a keyFact that is not one of the required facts", () => {
    // A key fact outside the criteria can never be matched, so every case
    // carrying one would cap at C for a reason nobody could see.
    expect(() =>
      parseDataset({
        ...valid,
        cases: [{ id: "a", question: "q", kind: "answerable", expectedFacts: ["x"], keyFact: "y" }],
      }),
    ).toThrow(/keyFact/);
  });

  it("rejects an injection case with nothing forbidden", () => {
    // The marker the corpus tries to make the model emit IS the test; without
    // one the case passes unconditionally and measures nothing.
    expect(() =>
      parseDataset({ ...valid, cases: [{ id: "a", question: "q", kind: "injection" }] }),
    ).toThrow(/mustNotContain/);
  });

  it("accepts an injection case that also carries marking criteria", () => {
    // Resisting must not come to mean refusing: a resistant answer is still
    // expected to answer the question.
    const d = parseDataset({
      ...valid,
      cases: [
        {
          id: "a",
          question: "q",
          kind: "injection",
          mustNotContain: ["MARKER"],
          expectedFacts: ["the real answer"],
        },
      ],
    });
    expect(d.cases[0]?.kind).toBe("injection");
  });

  it("requires expectedOptions on an ambiguous case and forbids them elsewhere", () => {
    // The pages a clarifying question must offer are the whole test (spec:
    // clarifying-questions); on any other kind the field would silently do nothing.
    expect(() =>
      parseDataset({ ...valid, cases: [{ id: "a", question: "q", kind: "ambiguous" }] }),
    ).toThrow(/expectedOptions/);
    expect(() =>
      parseDataset({
        ...valid,
        cases: [
          {
            id: "a",
            question: "q",
            kind: "ambiguous",
            expectedOptions: ["p"],
            expectedFacts: ["f"],
          },
        ],
      }),
    ).toThrow(/ambiguous/);
    expect(() =>
      parseDataset({
        ...valid,
        cases: [
          {
            id: "a",
            question: "q",
            kind: "answerable",
            expectedFacts: ["f"],
            expectedOptions: ["p"],
          },
        ],
      }),
    ).toThrow(/expectedOptions/);
    const d = parseDataset({
      ...valid,
      cases: [{ id: "a", question: "q", kind: "ambiguous", expectedOptions: ["A page"] }],
    });
    expect(splitByKind(d).ambiguous).toHaveLength(1);
    expect(describeBalance(d)).toBe("1 cases · 0 answerable · 0 unanswerable (0%) · 1 ambiguous");
  });

  it("rejects duplicate ids, which would collapse two cases in any diff", () => {
    expect(() =>
      parseDataset({
        ...valid,
        cases: [
          { id: "dup", question: "q1", kind: "answerable", expectedFacts: ["f"] },
          { id: "dup", question: "q2", kind: "answerable", expectedFacts: ["f"] },
        ],
      }),
    ).toThrow(/duplicate case ids/);
  });

  it("splits by kind and describes the balance", () => {
    const { answerable, unanswerable } = splitByKind(parseDataset(valid));
    expect(answerable).toHaveLength(1);
    expect(unanswerable).toHaveLength(1);
    expect(describeBalance(parseDataset(valid))).toBe(
      "2 cases · 1 answerable · 1 unanswerable (50%)",
    );
  });
});
