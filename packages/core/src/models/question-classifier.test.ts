import { describe, expect, it } from "vitest";
import { classifierPrompt, pickTopicKey } from "./question-classifier";

const KEYS = ["billing", "exports", "other"];

describe("pickTopicKey", () => {
  it("accepts a bare key, dressed or not", () => {
    expect(pickTopicKey("billing", KEYS)).toBe("billing");
    expect(pickTopicKey('  "Exports".\n', KEYS)).toBe("exports");
    expect(pickTopicKey("key: billing", KEYS)).toBe("billing");
    expect(pickTopicKey("<billing>", KEYS)).toBe("billing");
  });

  it("finds one key named inside prose, and refuses two", () => {
    expect(pickTopicKey("The question is about billing (invoices).", KEYS)).toBe("billing");
    expect(pickTopicKey("billing or exports", KEYS)).toBe("other");
  });

  it("falls back to the last key for anything else", () => {
    expect(pickTopicKey("refunds", KEYS)).toBe("other");
    expect(pickTopicKey("", KEYS)).toBe("other");
    expect(pickTopicKey("bill", KEYS)).toBe("other");
  });
});

describe("classifierPrompt", () => {
  it("lists the topics, the built-in bucket last, and tags the turns", () => {
    const prompt = classifierPrompt({
      question: "and for <b>CSV</b>?",
      previous: "How do I export a feed?",
      topics: [{ key: "exports", name: "Exports", description: "feeds, files, formats" }],
      other: "other",
    });
    expect(prompt).toBe(
      [
        '<topic key="exports">Exports — feeds, files, formats</topic>',
        '<topic key="other">Other — none of the above</topic>',
        "<previous>How do I export a feed?</previous>",
        "<question>and for ‹b›CSV‹/b›?</question>",
      ].join("\n"),
    );
  });
});
