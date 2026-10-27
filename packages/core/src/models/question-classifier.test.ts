import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_SYSTEM,
  classifierPrompt,
  parseClassification,
  pickTopicKey,
} from "./question-classifier";

const KEYS = ["billing", "exports", "other"];
const TOPICS = {
  topics: [
    { key: "billing", name: "Billing", description: "" },
    { key: "exports", name: "Exports", description: "" },
  ],
  other: "other",
};
const NO_TOPICS = { topics: [], other: "other" };

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

describe("parseClassification", () => {
  it("reads all three fields from a JSON reply", () => {
    expect(
      parseClassification(
        '{"topic": "exports", "intent": "how_to", "signals": ["pushback", "wants_human"]}',
        TOPICS,
      ),
    ).toEqual({ topic: "exports", intent: "how_to", signals: ["pushback", "wants_human"] });
  });

  it("ignores fences and prose around the object, and text after it", () => {
    const raw = 'Sure.\n```json\n{"topic":"billing","intent":"lookup","signals":[]}\n```\nDone.';
    expect(parseClassification(raw, TOPICS)).toEqual({
      topic: "billing",
      intent: "lookup",
      signals: [],
    });
  });

  it("is strict about keys: unknown intent is other, unknown signals are dropped", () => {
    expect(
      parseClassification(
        '{"topic":"refunds","intent":"complaint","signals":["angry","FRUSTRATION","pushback"]}',
        TOPICS,
      ),
    ).toEqual({ topic: "other", intent: "other", signals: ["pushback", "frustration"] });
  });

  it("gives a null topic to a project without topics, whatever the reply says", () => {
    expect(
      parseClassification('{"topic":"billing","intent":"request","signals":[]}', NO_TOPICS),
    ).toEqual({ topic: null, intent: "request", signals: [] });
  });

  it("accepts a lone signal string and a missing signals field", () => {
    expect(parseClassification('{"intent":"how_to","signals":"wants_human"}', NO_TOPICS)).toEqual({
      topic: null,
      intent: "how_to",
      signals: ["wants_human"],
    });
    expect(parseClassification('{"intent":"how_to"}', NO_TOPICS).signals).toEqual([]);
  });

  it("falls back to the bare topic key when the reply is not JSON", () => {
    expect(parseClassification("exports", TOPICS)).toEqual({
      topic: "exports",
      intent: "other",
      signals: [],
    });
    expect(parseClassification("", TOPICS)).toEqual({
      topic: "other",
      intent: "other",
      signals: [],
    });
    expect(parseClassification("{not json", TOPICS)).toEqual({
      topic: "other",
      intent: "other",
      signals: [],
    });
    expect(parseClassification("how_to", NO_TOPICS)).toEqual({
      topic: null,
      intent: "other",
      signals: [],
    });
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

  it("sends no topic lines for a project without topics, and names the product first", () => {
    expect(classifierPrompt({ question: "Hi", topics: [], other: "other" })).toBe(
      "<question>Hi</question>",
    );
    expect(
      classifierPrompt({ question: "Hi", product: "Acme <Feeds>", topics: [], other: "other" }),
    ).toBe("<product>Acme ‹Feeds›</product>\n<question>Hi</question>");
  });

  it("tells the model every intent and signal rule once, in the system prompt", () => {
    for (const key of ["how_to", "troubleshooting", "lookup", "request", "off_topic", "other"]) {
      expect(CLASSIFIER_SYSTEM).toContain(`- ${key}: `);
    }
    for (const key of ["pushback", "frustration", "wants_human"]) {
      expect(CLASSIFIER_SYSTEM).toContain(`- ${key}: `);
    }
  });
});
