import { describe, expect, it, vi } from "vitest";
import { retrievalOptionsFromEnv } from "./config";

describe("retrievalOptionsFromEnv", () => {
  it("returns no overrides when the variable is unset — the floor stays off", () => {
    expect(retrievalOptionsFromEnv({})).toEqual({});
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "  " })).toEqual({});
  });

  it("parses a floor an operator set deliberately", () => {
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "0.25" })).toEqual({
      minScore: 0.25,
    });
    // Explicit 0 is a valid answer: the floor is off, said out loud.
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "0" })).toEqual({ minScore: 0 });
  });

  it("ignores garbage rather than refusing answers over a typo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A misconfigured floor must degrade to the default, never take the
    // answer path down — same contract as the query planner.
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "high" })).toEqual({});
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "-0.2" })).toEqual({});
    expect(retrievalOptionsFromEnv({ DESKBELL_RETRIEVAL_MIN_SCORE: "1" })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("parses the hybrid-retrieval knobs an operator set deliberately", () => {
    expect(
      retrievalOptionsFromEnv({
        DESKBELL_RETRIEVAL_MODE: "hybrid",
        DESKBELL_RETRIEVAL_MULTI_QUERY: "on",
        DESKBELL_RETRIEVAL_LEG_DEPTH: "80",
        DESKBELL_RETRIEVAL_EF_SEARCH: "200",
        DESKBELL_RETRIEVAL_POOL: "32",
        DESKBELL_RETRIEVAL_MAX_PER_DOC: "2",
        DESKBELL_RETRIEVAL_ORDER: "cosine",
      }),
    ).toEqual({
      mode: "hybrid",
      multiQuery: true,
      legDepth: 80,
      efSearch: 200,
      pool: 32,
      maxPerDocument: 2,
      order: "cosine",
    });
    // Explicit off/0 are valid answers, said out loud.
    expect(
      retrievalOptionsFromEnv({
        DESKBELL_RETRIEVAL_MULTI_QUERY: "off",
        DESKBELL_RETRIEVAL_MAX_PER_DOC: "0",
      }),
    ).toEqual({ multiQuery: false, maxPerDocument: 0 });
  });

  it("ignores malformed hybrid knobs one by one, keeping the valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      retrievalOptionsFromEnv({
        DESKBELL_RETRIEVAL_MODE: "weaviate",
        DESKBELL_RETRIEVAL_MULTI_QUERY: "yes",
        DESKBELL_RETRIEVAL_LEG_DEPTH: "-5",
        DESKBELL_RETRIEVAL_EF_SEARCH: "0",
        DESKBELL_RETRIEVAL_POOL: "2.5",
        DESKBELL_RETRIEVAL_MAX_PER_DOC: "many",
        DESKBELL_RETRIEVAL_ORDER: "rrf",
        DESKBELL_RETRIEVAL_MIN_SCORE: "0.3",
      }),
    ).toEqual({ minScore: 0.3 });
    expect(warn).toHaveBeenCalledTimes(7);
    warn.mockRestore();
  });
});
