import { describe, expect, it, vi } from "vitest";

import {
  createGapAnalyst,
  EVIDENCE_CHARS,
  type GapAnalysisInput,
  MAX_EVIDENCE,
  MAX_QUESTIONS,
  prepareInput,
} from "./gap-analyst";

/**
 * Policy only, same posture as the reranker tests: whether the model writes a
 * useful finding is judged by reading findings, not here. What these pin is
 * what the analyst does BEFORE any model is touched.
 */

const env = (init: Record<string, string> = {}) => init as unknown as NodeJS.ProcessEnv;

/** Blows up if the analyst tries to reach a model when it should not. */
const forbiddenModel = () => {
  throw new Error("no model may be constructed or called on this path");
};

const input = (over: Partial<GapAnalysisInput> = {}): GapAnalysisInput => ({
  label: "How do I export?",
  questions: ["How do I export?", "Exporting — how?"],
  signals: { refused: true, downvoted: false, weak: false },
  evidence: [{ title: "Exports", url: "https://docs.test/exports", snippet: "Exports are CSV." }],
  ...over,
});

describe("createGapAnalyst", () => {
  it("builds without constructing a model, and picks its own model id", () => {
    const analyst = createGapAnalyst(forbiddenModel, env(), "openai/gpt-5-mini");
    expect(analyst.modelId).toBe("openai/gpt-5-mini");
    expect(
      createGapAnalyst(
        forbiddenModel,
        env({ DESKBELL_GAP_ANALYST_MODEL: "anthropic/claude-opus-5" }),
        "openai/gpt-5-mini",
      ).modelId,
    ).toBe("anthropic/claude-opus-5");
  });

  it("warns and keeps the default on a malformed timeout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createGapAnalyst(forbiddenModel, env({ DESKBELL_GAP_ANALYST_TIMEOUT_MS: "soon" }), "m");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DESKBELL_GAP_ANALYST_TIMEOUT_MS"));
    warn.mockRestore();
  });

  it("refuses empty material before any model call", async () => {
    const analyst = createGapAnalyst(forbiddenModel, env(), "m");
    await expect(analyst.analyze(input({ questions: [" ", ""] }))).rejects.toThrow(
      /at least one question/,
    );
  });

  it("hashes the material independent of order and case, and sensitive to the model", () => {
    const a = createGapAnalyst(forbiddenModel, env(), "openai/gpt-5-mini");
    const b = createGapAnalyst(forbiddenModel, env(), "anthropic/claude-opus-5");
    const same = a.inputHash(
      input({
        questions: ["exporting — how?", "HOW DO I EXPORT?"],
        evidence: [
          { title: "Exports", url: "https://docs.test/exports", snippet: "different text" },
        ],
      }),
    );
    expect(same).toBe(a.inputHash(input()));
    expect(a.inputHash(input({ questions: ["How do I import?"] }))).not.toBe(a.inputHash(input()));
    expect(b.inputHash(input())).not.toBe(a.inputHash(input()));
    expect(
      a.inputHash(input({ signals: { refused: false, downvoted: true, weak: false } })),
    ).not.toBe(a.inputHash(input()));
  });

  it("keeps stored hashes valid when the unsupported signal is absent or off", () => {
    // Every cluster analysed before verification existed must still read as
    // unchanged, or the column's arrival re-spends tokens on all of them.
    const a = createGapAnalyst(forbiddenModel, env(), "m");
    const before = a.inputHash(input());
    expect(
      a.inputHash(
        input({ signals: { refused: true, downvoted: false, weak: false, unsupported: false } }),
      ),
    ).toBe(before);
    expect(a.inputHash(input({ unsupportedTerms: [] }))).toBe(before);
    expect(
      a.inputHash(
        input({ signals: { refused: true, downvoted: false, weak: false, unsupported: true } }),
      ),
    ).not.toBe(before);
    expect(a.inputHash(input({ unsupportedTerms: ["Made Up"] }))).not.toBe(before);
    // Order-independent, like the rest of the material.
    expect(a.inputHash(input({ unsupportedTerms: ["B", "A"] }))).toBe(
      a.inputHash(input({ unsupportedTerms: ["A", "B"] })),
    );
  });
});

describe("prepareInput", () => {
  it("dedupes, trims and caps questions and evidence", () => {
    const many = Array.from({ length: MAX_QUESTIONS + 5 }, (_, i) => `q${i}`);
    const prepared = prepareInput(
      input({
        questions: [" a ", "A", "", ...many],
        evidence: Array.from({ length: MAX_EVIDENCE + 3 }, (_, i) => ({
          title: `t${i}`,
          snippet: "x".repeat(EVIDENCE_CHARS + 50),
        })),
      }),
    );
    expect(prepared.questions).toHaveLength(MAX_QUESTIONS);
    expect(prepared.questions[0]).toBe("a");
    expect(prepared.evidence).toHaveLength(MAX_EVIDENCE);
    expect(prepared.evidence[0]?.snippet).toHaveLength(EVIDENCE_CHARS);
    expect(prepareInput(input({ unsupportedTerms: [" Made Up ", ""] })).unsupportedTerms).toEqual([
      "Made Up",
    ]);
  });
});
