import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  answerExcerpt,
  contentHash,
  correctionAnswer,
  correctionContent,
  parseCorrectionForm,
} from "./corrections";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("correction text", () => {
  it("puts the question first as a heading and gets the answer back out", () => {
    const content = correctionContent("How do I cancel?", "Open Billing.\n\nChoose Cancel plan.");
    expect(content).toBe("# How do I cancel?\n\nOpen Billing.\n\nChoose Cancel plan.");
    expect(correctionAnswer("How do I cancel?", content)).toBe(
      "Open Billing.\n\nChoose Cancel plan.",
    );
  });

  it("returns the whole text when the heading is not the title, and nothing for no text", () => {
    expect(correctionAnswer("Other", "# How do I cancel?\n\nOpen Billing.")).toBe(
      "# How do I cancel?\n\nOpen Billing.",
    );
    expect(correctionAnswer("Other", null)).toBe("");
  });

  it("hashes the way the crawler path does", () => {
    const text = "# q\n\na";
    expect(contentHash(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("flattens and caps the excerpt", () => {
    expect(answerExcerpt("one\n\ntwo   three")).toBe("one two three");
    const long = "word ".repeat(100);
    const excerpt = answerExcerpt(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("parseCorrectionForm", () => {
  it("trims and accepts a question and an answer, with the optional ids", () => {
    const result = parseCorrectionForm(
      form({ question: "  How do I cancel?  ", answer: " Open Billing. ", clusterId: "gap_1" }),
    );
    expect(result).toEqual({
      data: { question: "How do I cancel?", answer: "Open Billing.", clusterId: "gap_1" },
    });
  });

  it("rejects a multi-line question, an empty question and an empty answer", () => {
    expect(parseCorrectionForm(form({ question: "a\nb", answer: "x" }))).toEqual({
      error: "The question must be one line",
    });
    expect(parseCorrectionForm(form({ question: "   ", answer: "x" })).error).toMatch(/question/);
    expect(parseCorrectionForm(form({ question: "q", answer: "" })).error).toMatch(/answer/);
  });

  it("treats an empty id as absent, so a new answer is not an edit of nothing", () => {
    const result = parseCorrectionForm(form({ id: "", clusterId: "", question: "q", answer: "a" }));
    expect(result.data).toEqual({ question: "q", answer: "a" });
  });
});
