import { describe, expect, it } from "vitest";

import { type CrossEncoder, createLocalReranker } from "./local-reranker";

/**
 * Policy + degradation only, with an injected encoder: whether the REAL
 * cross-encoder ranks well is the eval harness's job (D8), and loading the
 * real weights belongs to the documented manual pass, not to CI.
 */

const env = (init: Record<string, string> = {}) => init as unknown as NodeJS.ProcessEnv;

const chunk = (id: string, content = id) => ({
  chunkId: id,
  documentId: `doc_${id}`,
  position: null,
  title: id,
  content,
  score: 0.5,
});

/** An encoder that scores by a fixed table, keyed on the passage's first line. */
const fakeEncoder =
  (scores: Record<string, number>): (() => Promise<CrossEncoder>) =>
  async () => ({
    async score(_question, passages) {
      return passages.map((p) => scores[p.split("\n")[0] as string] ?? 0);
    },
  });

describe("createLocalReranker", () => {
  it("orders by descending logit, ties by incoming position", async () => {
    const rerank = createLocalReranker(env(), fakeEncoder({ a: -1.5, b: 3.2, c: 3.2, d: 7.0 }));
    const result = await rerank({
      question: "q",
      candidates: [chunk("a"), chunk("b"), chunk("c"), chunk("d")],
    });
    expect(result.order).toEqual([3, 1, 2, 0]);
    expect(result.scores).toEqual([7.0, 3.2, 3.2, -1.5]);
  });

  it("returns the identity order for a single candidate without loading anything", async () => {
    let loaded = 0;
    const rerank = createLocalReranker(env(), async () => {
      loaded++;
      return { score: async () => [] };
    });
    // Construction warms the loader in the background — that is allowed; the
    // point is that a 1-candidate request must not WAIT on it.
    const result = await rerank({ question: "q", candidates: [chunk("a")] });
    expect(result).toEqual({ order: [0] });
    expect(loaded).toBeLessThanOrEqual(1);
  });

  it("construction never throws, even when loading will fail — availability contract", async () => {
    const rerank = createLocalReranker(env(), async () => {
      throw new Error("optional dependency missing");
    });
    // The failure surfaces on the REQUEST path, where the engine degrades to
    // fusion order; construction (createEngineModelDeps) must stay clean.
    await expect(rerank({ question: "q", candidates: [chunk("a"), chunk("b")] })).rejects.toThrow(
      /optional dependency missing/,
    );
  });

  it("retries a failed load on the next request", async () => {
    // Attempt 1 is the construction-time warm-up; the first request receives
    // its cached failure and resets the cache; the second request loads
    // afresh and must recover without a process restart.
    let attempts = 0;
    const rerank = createLocalReranker(env(), async () => {
      attempts++;
      if (attempts < 2) throw new Error("network down");
      return { score: async (_q, passages) => passages.map((_, i) => -i) };
    });
    await expect(rerank({ question: "q", candidates: [chunk("a"), chunk("b")] })).rejects.toThrow(
      /network down/,
    );
    const result = await rerank({ question: "q", candidates: [chunk("a"), chunk("b")] });
    expect(result.order).toEqual([0, 1]);
    expect(attempts).toBe(2);
  });

  it("caps the pool it scores", async () => {
    let scored = 0;
    const rerank = createLocalReranker(env(), async () => ({
      score: async (_q, passages) => {
        scored = passages.length;
        return passages.map(() => 0);
      },
    }));
    const candidates = Array.from({ length: 80 }, (_, i) => chunk(`c${i}`));
    await rerank({ question: "q", candidates });
    expect(scored).toBe(50);
  });
});
