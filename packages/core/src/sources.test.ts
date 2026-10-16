import { describe, expect, it } from "vitest";

import { isBareTailTrusted, parseSourcesTail, selectByIndex, splitSourcesTail } from "./sources";

/**
 * The false-positive cases are the point of this file. An answer engine over
 * developer documentation streams code, and code is full of things that look
 * like machine output.
 */

describe("splitSourcesTail", () => {
  it("emits ordinary prose immediately", () => {
    expect(splitSourcesTail("Open Sources and paste the URL.")).toEqual({
      emit: "Open Sources and paste the URL.",
      hold: "",
    });
  });

  it("holds a final line that could still become the sources line", () => {
    const { emit, hold } = splitSourcesTail("Open Sources.\nSOU");
    expect(emit).toBe("Open Sources.");
    expect(hold).toBe("\nSOU");
  });

  it("releases a held line the moment it stops looking like one", () => {
    // "SOU" was a prefix; "SOUP" is not, and must reach the visitor.
    expect(splitSourcesTail("Open Sources.\nSOUP is not a source.")).toEqual({
      emit: "Open Sources.\nSOUP is not a source.",
      hold: "",
    });
  });

  it("holds nothing when the last line is plainly prose", () => {
    expect(splitSourcesTail("Step one.\nStep two.").hold).toBe("");
  });

  it("never holds an earlier line, only the last", () => {
    const { emit, hold } = splitSourcesTail("SOURCES: are listed below.\nThen more text.");
    expect(emit).toBe("SOURCES: are listed below.\nThen more text.");
    expect(hold).toBe("");
  });

  it("holds a final line of bare numbers, since the prefix may never come", () => {
    // Models drop the prefix. "1, 8" under an answer is a sources line until
    // proven otherwise, and proving it means waiting for the stream to close.
    expect(splitSourcesTail("Use the API.\n1, 8")).toEqual({
      emit: "Use the API.",
      hold: "\n1, 8",
    });
  });

  it("releases a numbers line the moment a letter arrives", () => {
    // "5000 items" is prose, and the visitor must not wait for the stream end.
    expect(splitSourcesTail("The limit is\n5000 items")).toEqual({
      emit: "The limit is\n5000 items",
      hold: "",
    });
  });
});

describe("parseSourcesTail", () => {
  it("reads the block numbers and removes the line from the answer", () => {
    expect(parseSourcesTail("\nSOURCES: 2, 5")).toEqual({
      indices: [2, 5],
      form: "prefixed",
      text: "",
    });
  });

  it("accepts a single source", () => {
    expect(parseSourcesTail("\nSOURCES: 3")).toEqual({ indices: [3], form: "prefixed", text: "" });
  });

  it("treats prose that merely starts with the word as prose", () => {
    // A documentation page ending "SOURCES: see the appendix" must not be
    // swallowed as machine output. Strict parsing is what protects it.
    const result = parseSourcesTail("\nSOURCES: see the appendix");
    expect(result.indices).toBeNull();
    expect(result.text).toBe("\nSOURCES: see the appendix");
  });

  it("treats an empty list as a formatting slip, not as citing nothing", () => {
    // Otherwise a real answer renders under no sources at all.
    expect(parseSourcesTail("\nSOURCES:").indices).toBeNull();
  });

  it("returns held text unchanged when there is no sources line", () => {
    expect(parseSourcesTail("\nSOUP is fine.")).toEqual({
      indices: null,
      text: "\nSOUP is fine.",
    });
  });

  it("labels the form so the caller can guard the bare one", () => {
    expect(parseSourcesTail("\nSOURCES: 2, 5").form).toBe("prefixed");
    expect(parseSourcesTail("\n1,8")).toEqual({ indices: [1, 8], form: "bare", text: "" });
    expect(parseSourcesTail("\n2").form).toBe("bare");
  });

  it("does not read numbers with anything else on the line as bare sources", () => {
    expect(parseSourcesTail("\n5000 items").indices).toBeNull();
    expect(parseSourcesTail("\nSee 1, 8").indices).toBeNull();
  });
});

describe("isBareTailTrusted", () => {
  it("trusts a bare line only when prose precedes it", () => {
    // The held tail keeps the newline that separated it from the answer; an
    // answer that is nothing but "5" never has one, and must never vanish.
    expect(isBareTailTrusted("\n2", [2], 8)).toBe(true);
    expect(isBareTailTrusted("2", [2], 8)).toBe(false);
  });

  it("trusts a bare line only when every number names a block", () => {
    // "The limit is\n5000" over eight blocks is an answer, not a citation.
    expect(isBareTailTrusted("\n5000", [5000], 8)).toBe(false);
    expect(isBareTailTrusted("\n1, 9", [1, 9], 8)).toBe(false);
    expect(isBareTailTrusted("\n0", [0], 8)).toBe(false);
    expect(isBareTailTrusted("\n1, 8", [1, 8], 8)).toBe(true);
  });
});

describe("selectByIndex", () => {
  const items = ["a", "b", "c"];

  it("maps 1-based block numbers to their items", () => {
    expect(selectByIndex(items, [1, 3])).toEqual(["a", "c"]);
  });

  it("drops numbers past the end rather than trusting them", () => {
    // A model that invents a ninth block over three must not reach past the array.
    expect(selectByIndex(items, [2, 9, 0, -1])).toEqual(["b"]);
  });

  it("keeps the model's order and ignores repeats", () => {
    expect(selectByIndex(items, [3, 1, 3])).toEqual(["c", "a"]);
  });

  it("returns nothing when no number is usable, so the caller can fall back", () => {
    expect(selectByIndex(items, [7, 8])).toEqual([]);
  });
});

describe("parseSourcesTail — tool references (spec: mcp-actions)", () => {
  it("separates block numbers from T-numbered tool results", () => {
    expect(parseSourcesTail("\nSOURCES: 2, T1, 5")).toEqual({
      indices: [2, 5],
      tools: [1],
      form: "prefixed",
      text: "",
    });
  });

  it("accepts a line naming only tool results", () => {
    expect(parseSourcesTail("\nSOURCES: T1, T2")).toEqual({
      indices: [],
      tools: [1, 2],
      form: "prefixed",
      text: "",
    });
  });

  it("holds a line that is on its way to naming a tool result", () => {
    expect(splitSourcesTail("Done.\nSOURCES: T")).toEqual({ emit: "Done.", hold: "\nSOURCES: T" });
  });

  it("does not read the bare form as tool references", () => {
    expect(parseSourcesTail("\nT1")).toEqual({ indices: null, text: "\nT1" });
  });
});
