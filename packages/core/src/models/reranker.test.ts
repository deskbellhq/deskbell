import { describe, expect, it, vi } from "vitest";

import { createLlmReranker, createReranker } from "./reranker";

/**
 * Policy only, same posture as the planner tests: what the drivers ask their
 * models for is their own concern; whether reranking HELPS is the eval
 * harness's job (D8), and whether a model obeys the prompt is measured
 * there against a real target.
 */

const env = (init: Record<string, string> = {}) => init as unknown as NodeJS.ProcessEnv;

/** Blows up if a driver tries to reach a model when it should not. */
const forbiddenModel = () => {
  throw new Error("no model may be constructed or called on this path");
};

const chunk = (id: string) => ({
  chunkId: id,
  documentId: `doc_${id}`,
  position: null,
  title: id,
  content: id,
  score: 0.5,
});

describe("createReranker (driver selection)", () => {
  it("is undefined when DESKBELL_RERANK is unset or off — the seam's no-op default", () => {
    expect(createReranker(forbiddenModel, env(), "openai/gpt-5-mini")).toBeUndefined();
    expect(
      createReranker(forbiddenModel, env({ DESKBELL_RERANK: "off" }), "openai/gpt-5-mini"),
    ).toBeUndefined();
  });

  it("warns and stays off on an unknown value rather than guessing a driver", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      createReranker(forbiddenModel, env({ DESKBELL_RERANK: "cohere" }), "openai/gpt-5-mini"),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("builds a driver for llm and local without touching a model", () => {
    // Both drivers construct lazily; selection alone must never reach a model
    // or the optional dependency.
    expect(
      createReranker(forbiddenModel, env({ DESKBELL_RERANK: "llm" }), "openai/gpt-5-mini"),
    ).toBeTypeOf("function");
    expect(
      createReranker(forbiddenModel, env({ DESKBELL_RERANK: "local" }), "openai/gpt-5-mini"),
    ).toBeTypeOf("function");
  });
});

describe("createLlmReranker", () => {
  it("returns the identity order for a single candidate without touching a model", async () => {
    // One candidate has exactly one order; a model call would be pure latency.
    // `forbiddenModel` proves none is even constructed.
    const rerank = createLlmReranker(forbiddenModel, env(), "openai/gpt-5-mini");
    const result = await rerank({ question: "q", candidates: [chunk("a")] });
    expect(result).toEqual({ order: [0] });
  });

  it("does not construct the model at build time — a bad id is a rerank error, not an outage", () => {
    // Same lazy-construction contract as the planner: createEngineModelDeps
    // must not throw over a setting that only ever costs quality.
    expect(() =>
      createLlmReranker(
        forbiddenModel,
        env({ DESKBELL_RERANK_MODEL: "bogus/nope" }),
        "openai/gpt-5-mini",
      ),
    ).not.toThrow();
  });
});
