import { describe, expect, it } from "vitest";

import { evidenceLabel, isAction, isWrittenAnswer } from "./citation-label";

describe("citation labels", () => {
  it("recognises a written answer by its source kind, and nothing else", () => {
    expect(isWrittenAnswer({ kind: "corrections" })).toBe(true);
    expect(isWrittenAnswer({ kind: "docs-crawler" })).toBe(false);
    expect(isWrittenAnswer({})).toBe(false);
    expect(isWrittenAnswer({ kind: null })).toBe(false);
  });

  it("labels evidence by URL, then as a written answer, then by title", () => {
    expect(evidenceLabel({ title: "Keys", url: "https://d.test/keys", kind: "docs-crawler" })).toBe(
      "https://d.test/keys",
    );
    expect(evidenceLabel({ title: "How do I cancel?", kind: "corrections" })).toBe(
      "written answer: How do I cancel?",
    );
    expect(evidenceLabel({ title: "Old row" })).toBe("Old row");
  });

  it("recognises a tool result and labels it as an action", () => {
    expect(isAction({ kind: "action" })).toBe(true);
    expect(isAction({ kind: "docs-crawler" })).toBe(false);
    expect(evidenceLabel({ title: "Look up your order", kind: "action" })).toBe(
      "action: Look up your order",
    );
  });
});
