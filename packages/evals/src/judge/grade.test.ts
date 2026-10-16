import { describe, expect, it } from "vitest";
import type { EvalCase } from "../types";
import { factCoverage, gradeFromFacts, reconcileFacts } from "./grade";

const criteria = ["alpha", "beta", "gamma"];

describe("gradeFromFacts", () => {
  it("awards A only when every criterion is present", () => {
    expect(gradeFromFacts(criteria, criteria, "alpha")).toBe("A");
    expect(gradeFromFacts(criteria, ["alpha", "beta"], "alpha")).toBe("B");
  });

  it("awards B on the key fact alone and C without it", () => {
    expect(gradeFromFacts(criteria, ["alpha"], "alpha")).toBe("B");
    expect(gradeFromFacts(criteria, ["beta"], "alpha")).toBe("C");
  });

  it("falls back to any match when no key fact is declared", () => {
    expect(gradeFromFacts(criteria, ["beta"], undefined)).toBe("B");
    expect(gradeFromFacts(criteria, [], undefined)).toBe("C");
  });

  it("never awards A for a case with no criteria at all", () => {
    // "every one of zero facts is present" is vacuously true and would hand a
    // free A to any case someone forgot to write criteria for.
    expect(gradeFromFacts([], [], undefined)).toBe("C");
  });
});

describe("factCoverage", () => {
  it("is the share of criteria present, not a half-step", () => {
    expect(factCoverage(criteria, ["alpha", "beta"])).toBeCloseTo(2 / 3);
    expect(factCoverage(criteria, [])).toBe(0);
  });

  it("counts each criterion once however often it is claimed", () => {
    expect(factCoverage(criteria, ["alpha", "alpha", "alpha"])).toBeCloseTo(1 / 3);
  });

  it("is null when the case declares no criteria", () => {
    expect(factCoverage([], [])).toBeNull();
  });
});

describe("reconcileFacts", () => {
  const evalCase: EvalCase = {
    id: "c",
    question: "q",
    kind: "answerable",
    expectedFacts: criteria,
  };

  it("keeps only the criteria the judge really matched", () => {
    const r = reconcileFacts(evalCase, ["alpha"]);
    expect(r.matched).toEqual(["alpha"]);
    expect(r.missing).toEqual(["beta", "gamma"]);
    expect(r.anomaly).toBe(false);
  });

  it("drops a paraphrase and flags it, rather than scoring a point for it", () => {
    // A judge told to quote the criteria verbatim sometimes summarises them
    // instead. Scoring the summary awards a mark for the wrong reason and
    // nothing downstream could tell.
    const r = reconcileFacts(evalCase, ["alpha", "roughly beta-ish"]);
    expect(r.matched).toEqual(["alpha"]);
    expect(r.anomaly).toBe(true);
  });
});
