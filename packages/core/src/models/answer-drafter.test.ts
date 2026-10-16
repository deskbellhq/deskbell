import { describe, expect, it, vi } from "vitest";

import {
  type AnswerDraftInput,
  createAnswerDrafter,
  draftPrompt,
  EVIDENCE_CHARS,
  MAX_EVIDENCE,
  MAX_QUESTIONS,
  prepareInput,
} from "./answer-drafter";

/**
 * Policy only, the same posture as the analyst's tests: whether the model
 * writes a useful draft is judged by reading drafts, not here. What these
 * pin is what the drafter does BEFORE any model is touched, and what the
 * model is handed when one is.
 */

const env = (init: Record<string, string> = {}) => init as unknown as NodeJS.ProcessEnv;

/** Blows up if the drafter reaches a model when it should not. */
const forbiddenModel = () => {
  throw new Error("no model may be constructed or called on this path");
};

const input = (over: Partial<AnswerDraftInput> = {}): AnswerDraftInput => ({
  question: "How do I export a feed?",
  questions: ["How do I export a feed?", "Exporting feeds — how?"],
  evidence: [
    { title: "Importing a feed", url: "https://docs.test/import", snippet: "Imports run nightly." },
  ],
  analysis: null,
  ...over,
});

describe("createAnswerDrafter", () => {
  it("builds without constructing a model, and picks its own model id", () => {
    expect(createAnswerDrafter(forbiddenModel, env(), "openai/gpt-5-mini").modelId).toBe(
      "openai/gpt-5-mini",
    );
    expect(
      createAnswerDrafter(
        forbiddenModel,
        env({ DESKBELL_ANSWER_DRAFTER_MODEL: "anthropic/claude-opus-5" }),
        "openai/gpt-5-mini",
      ).modelId,
    ).toBe("anthropic/claude-opus-5");
  });

  it("warns and keeps the default on a malformed timeout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createAnswerDrafter(forbiddenModel, env({ DESKBELL_ANSWER_DRAFTER_TIMEOUT_MS: "soon" }), "m");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("DESKBELL_ANSWER_DRAFTER_TIMEOUT_MS"),
    );
    warn.mockRestore();
  });

  it("refuses a draft with no question before reaching a model", async () => {
    const drafter = createAnswerDrafter(forbiddenModel, env(), "m");
    await expect(drafter.draft(input({ question: "   " }))).rejects.toThrow(/needs a question/);
  });
});

describe("prepareInput", () => {
  it("trims, dedupes case-insensitively and caps the questions", () => {
    const prepared = prepareInput(
      input({
        questions: [
          "  How do I export?  ",
          "how do i export?",
          "",
          ...Array.from({ length: MAX_QUESTIONS + 4 }, (_, i) => `phrasing ${i}`),
        ],
      }),
    );
    expect(prepared.questions).toHaveLength(MAX_QUESTIONS);
    expect(prepared.questions[0]).toBe("How do I export?");
    expect(prepared.questions).not.toContain("how do i export?");
  });

  it("caps the passages and truncates each snippet", () => {
    const prepared = prepareInput(
      input({
        evidence: Array.from({ length: MAX_EVIDENCE + 3 }, (_, i) => ({
          title: `Page ${i}`,
          snippet: "x".repeat(EVIDENCE_CHARS + 500),
        })),
      }),
    );
    expect(prepared.evidence).toHaveLength(MAX_EVIDENCE);
    expect(prepared.evidence[0]?.snippet).toHaveLength(EVIDENCE_CHARS);
  });

  it("drops empty suggested facts and keeps the analysis otherwise", () => {
    const prepared = prepareInput(
      input({
        analysis: {
          finding: "  Nothing covers exports.  ",
          recommendation: "Write an Exports page.",
          suggestedFacts: ["Exports are CSV", "   ", ""],
        },
      }),
    );
    expect(prepared.analysis).toEqual({
      finding: "Nothing covers exports.",
      recommendation: "Write an Exports page.",
      suggestedFacts: ["Exports are CSV"],
    });
  });
});

describe("draftPrompt", () => {
  it("wraps every question and passage in a tag, with the analysis when there is one", () => {
    const prompt = draftPrompt(
      prepareInput(
        input({
          analysis: {
            finding: "Nothing covers exports.",
            recommendation: "Write an Exports page.",
            suggestedFacts: ["Exports are CSV"],
          },
        }),
      ),
    );
    expect(prompt).toContain("<question>How do I export a feed?</question>");
    expect(prompt).toContain("<question>Exporting feeds — how?</question>");
    expect(prompt).toContain(
      '<passage n="1" title="Importing a feed" url="https://docs.test/import">',
    );
    expect(prompt).toContain("Imports run nightly.");
    expect(prompt).toContain("<analysis>");
    expect(prompt).toContain("A correct answer states:\n- Exports are CSV");
  });

  it("says outright when retrieval found nothing, and leaves the analysis out when it has not run", () => {
    const prompt = draftPrompt(prepareInput(input({ evidence: [] })));
    expect(prompt).toContain("not in the indexed content at all");
    expect(prompt).not.toContain("<analysis>");
  });

  it("does not let a passage title break out of its own attribute", () => {
    const prompt = draftPrompt(
      prepareInput(input({ evidence: [{ title: 'A " onerror="x', snippet: "s" }] })),
    );
    expect(prompt).toContain(`title="A ' onerror='x"`);
  });
});
