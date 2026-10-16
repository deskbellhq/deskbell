import { describe, expect, it } from "vitest";
import { clarificationText, parseCitations, uniqueByDocument } from "./conversation";

describe("parseCitations", () => {
  const stored = { documentId: "d1", title: "Install", snippet: "…", url: "https://x.test/a" };

  it("parses rows stored before citations carried a kind, and rows with one", () => {
    expect(parseCitations([stored])).toEqual([stored]);
    expect(parseCitations([{ ...stored, kind: "docs-crawler" }])).toEqual([
      { ...stored, kind: "docs-crawler" },
    ]);
  });

  it("rejects the whole array when a required field is missing, and null stays null", () => {
    expect(parseCitations([{ documentId: "d1" }])).toBeNull();
    expect(parseCitations(null)).toBeNull();
  });

  it("keeps one citation per document", () => {
    expect(uniqueByDocument([stored, { ...stored, snippet: "other" }])).toEqual([stored]);
  });
});

describe("clarificationText", () => {
  it("stores the question with the options as a list", () => {
    expect(clarificationText({ question: " Which one? ", options: ["A page", "Another"] })).toBe(
      "Which one?\n\n- A page\n- Another",
    );
  });
});
