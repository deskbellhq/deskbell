import { describe, expect, it } from "vitest";
import {
  classificationGateFailures,
  parseLabelledSet,
  renderClassificationMarkdown,
  scoreClassification,
} from "./classification";

const CASES = parseLabelledSet(
  [
    '{"id":"a","question":"How do I export?","intent":"how_to"}',
    '{"id":"b","question":"No, I meant to CSV","previous":"How do I export?","intent":"how_to","signals":["pushback"]}',
    '{"id":"c","question":"Can I talk to someone?","intent":"other","signals":["wants_human"]}',
    '{"id":"d","question":"Does it do webhooks? It should.","intent":"request","signals":[]}',
    "",
    "# a comment",
  ].join("\n"),
);

describe("parseLabelledSet", () => {
  it("reads ids, optional fields and skips blanks and comments", () => {
    expect(CASES.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(CASES[1]?.previous).toBe("How do I export?");
    expect(CASES[0]?.signals).toEqual([]);
  });
  it("numbers a case without an id by its line and names a bad line", () => {
    expect(parseLabelledSet('{"question":"Hi","intent":"other"}')[0]?.id).toBe("line-1");
    expect(() => parseLabelledSet('{"question":"Hi","intent":"angry"}')).toThrow("line 1");
    expect(() => parseLabelledSet('\n{"question":"Hi","intent":"other","signals":["x"]}')).toThrow(
      "line 2",
    );
    expect(() => parseLabelledSet("nope")).toThrow("not JSON");
  });
});

describe("scoreClassification", () => {
  it("scores intent agreement, the confusion table and each signal apart", () => {
    const report = scoreClassification(CASES, [
      { id: "a", intent: "how_to", signals: [] },
      { id: "b", intent: "troubleshooting", signals: ["pushback", "frustration"] },
      { id: "c", intent: "other", signals: [] },
      { id: "d", intent: "request", signals: ["wants_human"] },
    ]);
    expect(report.cases).toBe(4);
    expect(report.intentAgreement).toBe(0.75);
    expect(report.confusion.how_to).toEqual({ how_to: 1, troubleshooting: 1 });
    expect(report.intentRecall.how_to).toEqual({ agreed: 1, total: 2 });
    expect(report.intentMisses).toEqual([
      { id: "b", labelled: "how_to", predicted: "troubleshooting" },
    ]);
    expect(report.signalMisses).toEqual([
      { id: "b", labelled: ["pushback"], predicted: ["pushback", "frustration"] },
      { id: "c", labelled: ["wants_human"], predicted: [] },
      { id: "d", labelled: [], predicted: ["wants_human"] },
    ]);
    const by = Object.fromEntries(report.signals.map((s) => [s.signal, s]));
    expect(by.pushback).toMatchObject({ precision: 1, recall: 1 });
    expect(by.frustration).toMatchObject({ precision: 0, recall: null, falsePositives: 1 });
    expect(by.wants_human).toMatchObject({
      precision: 0,
      recall: 0,
      falsePositives: 1,
      falseNegatives: 1,
    });
  });
  it("ignores cases the model did not answer and divides by nothing as null", () => {
    const report = scoreClassification(CASES, []);
    expect(report.cases).toBe(0);
    expect(report.intentAgreement).toBeNull();
    expect(classificationGateFailures(report)).toEqual([]);
  });
});

describe("the gate", () => {
  it("names every threshold that is missed", () => {
    const report = scoreClassification(CASES, [
      { id: "a", intent: "lookup", signals: ["wants_human"] },
      { id: "b", intent: "how_to", signals: [] },
      { id: "c", intent: "other", signals: ["wants_human"] },
      { id: "d", intent: "request", signals: [] },
    ]);
    expect(classificationGateFailures(report)).toEqual([
      "intent agreement 75% is under 80%",
      "wants_human precision 50% is under 90%",
      "pushback recall 0% is under 70%",
    ]);
    const md = renderClassificationMarkdown(report, { model: "test/model", dataset: "x.jsonl" });
    expect(md).toContain("**Gate: failed**");
    expect(md).toContain("| how_to | 2 | 50% |");
    expect(md).toContain("| wants_human | 50% | 100% | 1 | 1 | 0 |");
    expect(md).toContain("| a | how_to | lookup |");
    expect(md).toContain("| a | — | wants_human |");
  });
  it("passes a clean run", () => {
    const report = scoreClassification(
      CASES,
      CASES.map((c) => ({ id: c.id, intent: c.intent, signals: c.signals })),
    );
    expect(classificationGateFailures(report)).toEqual([]);
    expect(renderClassificationMarkdown(report, { model: "m", dataset: "d" })).toContain(
      "**Gate: passed.**",
    );
  });
});
