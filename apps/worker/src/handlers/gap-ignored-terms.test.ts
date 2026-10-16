import { effectiveIgnoredTerms, stripIgnoredTerms } from "@deskbell/db";
import { describe, expect, it } from "vitest";

/**
 * The text a gap question is embedded as (spec:
 * gap-cluster-members-and-ignored-terms). Measured motivation: a product name
 * in both questions pulled unrelated needs to 0.83 cosine, above the merge
 * threshold.
 */
describe("stripIgnoredTerms", () => {
  it("removes a term wherever it appears, whatever its case", () => {
    expect(stripIgnoredTerms("How much does Deskbell cost?", ["Deskbell"])).toBe(
      "How much does cost?",
    );
    expect(stripIgnoredTerms("What is Deskbell?", ["Deskbell"])).toBe("What is?");
    expect(stripIgnoredTerms("what is deskbell", ["Deskbell"])).toBe("what is");
  });

  it("matches whole words only", () => {
    expect(stripIgnoredTerms("Are Deskbells loud?", ["Deskbell"])).toBe("Are Deskbells loud?");
    expect(stripIgnoredTerms("Is deskbell.dev the docs site?", ["Deskbell"])).toBe(
      "Is deskbell.dev the docs site?",
    );
  });

  it("takes a term of several words, and any whitespace between them", () => {
    expect(stripIgnoredTerms("Does Acme Corp  support SSO?", ["Acme Corp"])).toBe(
      "Does support SSO?",
    );
  });

  it("treats a term with regex characters as text", () => {
    expect(stripIgnoredTerms("What does C++ cost?", ["C++"])).toBe("What does cost?");
  });

  it("keeps the question as typed when stripping would leave nothing", () => {
    expect(stripIgnoredTerms("Deskbell?", ["Deskbell"])).toBe("Deskbell?");
    expect(stripIgnoredTerms("How do I install?", [])).toBe("How do I install?");
  });
});

describe("effectiveIgnoredTerms", () => {
  it("falls back to the organisation's name when the project has no list", () => {
    expect(effectiveIgnoredTerms({}, "Acme")).toEqual(["Acme"]);
    expect(effectiveIgnoredTerms(null, "Acme")).toEqual(["Acme"]);
  });

  it("takes an empty list literally — that is an operator saying 'strip nothing'", () => {
    expect(effectiveIgnoredTerms({ ignoredTerms: [] }, "Acme")).toEqual([]);
  });

  it("uses the configured list over the organisation's name", () => {
    expect(effectiveIgnoredTerms({ ignoredTerms: ["Deskbell", "the bell"] }, "Acme")).toEqual([
      "Deskbell",
      "the bell",
    ]);
  });

  it("strips nothing when there is no name to fall back to", () => {
    expect(effectiveIgnoredTerms(undefined, "  ")).toEqual([]);
  });
});
