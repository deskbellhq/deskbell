import { describe, expect, it } from "vitest";
import {
  OTHER_TOPIC,
  ProjectTopicsSchema,
  parseTopics,
  TOPIC_LIMIT,
  topicKey,
  topicName,
  topicsToText,
} from "./topics.ts";

describe("topicKey", () => {
  it("lower-cases, folds diacritics and hyphenates", () => {
    expect(topicKey("Feed exports")).toBe("feed-exports");
    expect(topicKey("  Zamówienia & zwroty ")).toBe("zamowienia-zwroty");
    expect(topicKey("API / SDK")).toBe("api-sdk");
  });

  it("always starts with a letter and is empty for nothing usable", () => {
    expect(topicKey("2FA")).toBe("t-2fa");
    expect(topicKey("???")).toBe("");
  });
});

describe("parseTopics", () => {
  it("reads one topic per line with an optional description", () => {
    expect(parseTopics("Billing: invoices, plans and payment\nExports\n\n")).toEqual({
      ok: true,
      topics: [
        { key: "billing", name: "Billing", description: "invoices, plans and payment" },
        { key: "exports", name: "Exports", description: "" },
      ],
    });
  });

  it("keeps a colon inside the description", () => {
    const parsed = parseTopics("Time: formats like 10:30");
    expect(parsed.ok && parsed.topics[0]?.description).toBe("formats like 10:30");
  });

  it("refuses duplicates, the built-in bucket and too many", () => {
    expect(parseTopics("Billing\nbilling: twice").ok).toBe(false);
    expect(parseTopics("Other: the rest").ok).toBe(false);
    const many = Array.from({ length: TOPIC_LIMIT + 1 }, (_, i) => `Topic ${i}`).join("\n");
    expect(parseTopics(many).ok).toBe(false);
    expect(parseTopics(": no name").ok).toBe(false);
  });

  it("round-trips through the textarea text", () => {
    const text = "Billing: invoices\nExports";
    const parsed = parseTopics(text);
    expect(parsed.ok && topicsToText(parsed.topics)).toBe(text);
  });
});

describe("topicName", () => {
  const topics = ProjectTopicsSchema.parse([{ key: "billing", name: "Billing" }]);
  it("names a configured topic, the built-in bucket and an orphaned key", () => {
    expect(topicName(topics, "billing")).toBe("Billing");
    expect(topicName(topics, OTHER_TOPIC)).toBe("Other");
    expect(topicName(topics, "exports")).toBe("exports");
  });
});
