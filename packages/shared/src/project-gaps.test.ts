import { describe, expect, it } from "vitest";
import { IGNORED_TERM_LIMIT, ProjectGapsSchema, parseIgnoredTerms } from "./index.ts";

describe("ProjectGapsSchema", () => {
  it("accepts an empty document and an empty list as different things", () => {
    expect(ProjectGapsSchema.parse({})).toEqual({});
    expect(ProjectGapsSchema.parse({ ignoredTerms: [] })).toEqual({ ignoredTerms: [] });
  });

  it("trims and de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(ProjectGapsSchema.parse({ ignoredTerms: ["  Deskbell ", "deskbell", "Acme"] })).toEqual({
      ignoredTerms: ["Deskbell", "Acme"],
    });
  });

  it("refuses a blank term and a list that is too long", () => {
    expect(ProjectGapsSchema.safeParse({ ignoredTerms: ["  "] }).success).toBe(false);
    const many = Array.from({ length: IGNORED_TERM_LIMIT + 1 }, (_, i) => `t${i}`);
    expect(ProjectGapsSchema.safeParse({ ignoredTerms: many }).success).toBe(false);
  });
});

describe("parseIgnoredTerms", () => {
  it("splits on newlines and commas, keeping spaces inside a term", () => {
    const parsed = parseIgnoredTerms("Deskbell\nAcme Corp, the bell\n\n");
    expect(parsed).toEqual({ ok: true, terms: ["Deskbell", "Acme Corp", "the bell"] });
  });

  it("reads an empty box as an empty list, not as 'unset'", () => {
    expect(parseIgnoredTerms("   ")).toEqual({ ok: true, terms: [] });
  });

  it("names the term that is too long", () => {
    const parsed = parseIgnoredTerms(`ok\n${"x".repeat(101)}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("too long");
  });
});
