import { describe, expect, it } from "vitest";
import {
  createEmbedder,
  createEngineModelDeps,
  createGapAnalystDeps,
  embeddingProviderOptions,
  modelProviderStatus,
  parseModelId,
  reasoningEffort,
  reasoningProviderOptions,
} from "./index";

// Construction only — no test here may hit the network. Provider SDKs read
// credentials at request time, so building deps without keys must succeed;
// what these pin is the provider switch, not the providers.

describe("parseModelId", () => {
  it("splits provider/model and keeps slashes in the model half", () => {
    expect(parseModelId("openai/gpt-5-mini")).toEqual({ provider: "openai", model: "gpt-5-mini" });
    expect(parseModelId("ollama/library/llama3.3")).toEqual({
      provider: "ollama",
      model: "library/llama3.3",
    });
  });

  it("rejects ids without a provider half", () => {
    expect(() => parseModelId("gpt-5-mini")).toThrow(/provider\/model/);
    expect(() => parseModelId("openai/")).toThrow(/provider\/model/);
  });
});

describe("provider wiring (D4/D13)", () => {
  it("builds deps for every wired chat provider", () => {
    for (const chat of [
      "openai/gpt-5-mini",
      "anthropic/claude-opus-5",
      "google/gemini-2.5-flash",
      "ollama/llama3.3",
    ]) {
      expect(() =>
        createEngineModelDeps({
          DESKBELL_CHAT_MODEL: chat,
          DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
        }),
      ).not.toThrow();
    }
  });

  it("builds the gap analyst for every wired chat provider without touching one", () => {
    for (const chat of [
      "openai/gpt-5-mini",
      "anthropic/claude-opus-5",
      "google/gemini-2.5-flash",
      "ollama/llama3.3",
    ]) {
      const analyst = createGapAnalystDeps({ DESKBELL_GAP_ANALYST_MODEL: chat });
      expect(analyst.modelId).toBe(chat);
    }
  });

  it("builds an ollama embedder — the fully local path needs no hosted key", () => {
    expect(() =>
      createEmbedder({ DESKBELL_EMBEDDING_MODEL: "ollama/nomic-embed-text" }),
    ).not.toThrow();
  });

  it("builds a google embedder pinned to the schema's width, queries and documents apart", () => {
    expect(() =>
      createEmbedder({ DESKBELL_EMBEDDING_MODEL: "google/gemini-embedding-001" }),
    ).not.toThrow();
    // Google's default is 3072 wide; the vector column is not. Pinning at
    // construction beats a Postgres error on the first insert.
    expect(embeddingProviderOptions("google", "document")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_DOCUMENT" },
    });
    expect(embeddingProviderOptions("google", "query")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_QUERY" },
    });
    expect(embeddingProviderOptions("openai", "query")).toBeUndefined();
    expect(embeddingProviderOptions("ollama", "document")).toBeUndefined();
  });

  it("refuses anthropic embeddings with the pairing that works instead", () => {
    // Anthropic has no embeddings API; failing at construction with the fix
    // in the message beats a 404 from the first embed call.
    expect(() => createEmbedder({ DESKBELL_EMBEDDING_MODEL: "anthropic/claude-opus-5" })).toThrow(
      /no embeddings API.*openai\/\*.*google\/\*.*ollama\/\*/s,
    );
  });

  it("names the wired providers when rejecting an unknown one", () => {
    expect(() =>
      createEngineModelDeps({
        DESKBELL_CHAT_MODEL: "mistral/mistral-large",
        DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      }),
    ).toThrow(/openai\/\*.*anthropic\/\*.*google\/\*.*ollama\/\*/s);
  });
});

describe("reasoning effort (DESKBELL_REASONING_EFFORT)", () => {
  it("defaults to low — the answer path never waits on a provider default", () => {
    expect(reasoningEffort({})).toBe("low");
    expect(reasoningEffort({ DESKBELL_REASONING_EFFORT: "" })).toBe("low");
  });

  it("accepts every level, case-insensitively, and falls back on nonsense", () => {
    for (const level of ["minimal", "low", "medium", "high", "provider"]) {
      expect(reasoningEffort({ DESKBELL_REASONING_EFFORT: level })).toBe(level);
      expect(reasoningEffort({ DESKBELL_REASONING_EFFORT: ` ${level.toUpperCase()} ` })).toBe(
        level,
      );
    }
    expect(reasoningEffort({ DESKBELL_REASONING_EFFORT: "max" })).toBe("low");
    expect(reasoningEffort({ DESKBELL_REASONING_EFFORT: "none" })).toBe("low");
  });

  it("pins the effort for openai only, and sends nothing on 'provider'", () => {
    expect(reasoningProviderOptions("openai", "minimal")).toEqual({
      openai: { reasoningEffort: "minimal" },
    });
    expect(reasoningProviderOptions("openai", "provider")).toBeUndefined();
    expect(reasoningProviderOptions("anthropic", "minimal")).toBeUndefined();
    expect(reasoningProviderOptions("ollama", "low")).toBeUndefined();
    expect(reasoningProviderOptions("google", "low")).toBeUndefined();
  });

  it("builds deps at every level for every wired chat provider", () => {
    for (const level of ["minimal", "low", "medium", "high", "provider"]) {
      for (const chat of ["openai/gpt-5-mini", "anthropic/claude-opus-5", "ollama/llama3.3"]) {
        expect(() =>
          createEngineModelDeps({
            DESKBELL_CHAT_MODEL: chat,
            DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
            DESKBELL_REASONING_EFFORT: level,
          }),
        ).not.toThrow();
      }
    }
  });
});

describe("modelProviderStatus", () => {
  it("names the missing key for the default models", () => {
    const status = modelProviderStatus({});
    expect(status.chat).toEqual({
      id: "openai/gpt-5-mini",
      provider: "openai",
      keyEnv: "OPENAI_API_KEY",
      configured: false,
    });
    expect(status.embedding.keyEnv).toBe("OPENAI_API_KEY");
    expect(status.embedding.configured).toBe(false);
  });

  it("treats a blank key as missing", () => {
    expect(modelProviderStatus({ OPENAI_API_KEY: "   " }).chat.configured).toBe(false);
    expect(modelProviderStatus({ OPENAI_API_KEY: "sk-x" }).chat.configured).toBe(true);
    const google = modelProviderStatus({ DESKBELL_CHAT_MODEL: "google/gemini-2.5-flash" }).chat;
    expect(google.keyEnv).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(google.configured).toBe(false);
  });

  it("checks each model's own provider", () => {
    const status = modelProviderStatus({
      DESKBELL_CHAT_MODEL: "anthropic/claude-opus-5",
      DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      ANTHROPIC_API_KEY: "sk-ant",
    });
    expect(status.chat).toMatchObject({ keyEnv: "ANTHROPIC_API_KEY", configured: true });
    expect(status.embedding).toMatchObject({ keyEnv: "OPENAI_API_KEY", configured: false });
  });

  it("needs no key for a local provider", () => {
    const status = modelProviderStatus({
      DESKBELL_CHAT_MODEL: "ollama/llama3.3",
      DESKBELL_EMBEDDING_MODEL: "ollama/nomic-embed-text",
    });
    expect(status.chat).toMatchObject({ keyEnv: null, configured: true });
    expect(status.embedding).toMatchObject({ keyEnv: null, configured: true });
  });

  it("reports an unknown provider as unconfigured rather than guessing a variable", () => {
    const status = modelProviderStatus({ DESKBELL_CHAT_MODEL: "mistral/large" });
    expect(status.chat).toMatchObject({ provider: "mistral", keyEnv: null, configured: false });
  });
});
