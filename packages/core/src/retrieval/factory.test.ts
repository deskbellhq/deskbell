import { describe, expect, it } from "vitest";
import { vectorStoreConfigFromEnv } from "./factory";

describe("vectorStoreConfigFromEnv", () => {
  it("defaults to pgvector, also on an explicit or blank value", () => {
    expect(vectorStoreConfigFromEnv({})).toEqual({ driver: "pgvector" });
    expect(vectorStoreConfigFromEnv({ DESKBELL_VECTOR_STORE: " PgVector " })).toEqual({
      driver: "pgvector",
    });
    expect(vectorStoreConfigFromEnv({ DESKBELL_VECTOR_STORE: "" })).toEqual({ driver: "pgvector" });
  });

  it("rejects an unknown driver rather than falling back", () => {
    expect(() => vectorStoreConfigFromEnv({ DESKBELL_VECTOR_STORE: "weviate" })).toThrow(
      /expected pgvector or weaviate/,
    );
  });

  it("needs a URL for weaviate and fills the collection default", () => {
    expect(() => vectorStoreConfigFromEnv({ DESKBELL_VECTOR_STORE: "weaviate" })).toThrow(
      /WEAVIATE_URL/,
    );
    expect(() =>
      vectorStoreConfigFromEnv({ DESKBELL_VECTOR_STORE: "weaviate", WEAVIATE_URL: "not a url" }),
    ).toThrow(/not a URL/);
    expect(
      vectorStoreConfigFromEnv({
        DESKBELL_VECTOR_STORE: "weaviate",
        WEAVIATE_URL: "http://localhost:8080",
      }),
    ).toEqual({
      driver: "weaviate",
      weaviate: { url: "http://localhost:8080", collection: "DeskbellChunk" },
    });
  });

  it("carries the optional settings through and checks the collection name", () => {
    expect(
      vectorStoreConfigFromEnv({
        DESKBELL_VECTOR_STORE: "weaviate",
        WEAVIATE_URL: "https://w.example.com",
        WEAVIATE_GRPC_URL: "grpcs://w.example.com:50051",
        WEAVIATE_API_KEY: "secret",
        WEAVIATE_COLLECTION: "Deskbell_prod",
      }),
    ).toEqual({
      driver: "weaviate",
      weaviate: {
        url: "https://w.example.com",
        grpcUrl: "grpcs://w.example.com:50051",
        apiKey: "secret",
        collection: "Deskbell_prod",
      },
    });
    expect(() =>
      vectorStoreConfigFromEnv({
        DESKBELL_VECTOR_STORE: "weaviate",
        WEAVIATE_URL: "http://w",
        WEAVIATE_COLLECTION: "deskbell-chunk",
      }),
    ).toThrow(/collection name/);
  });
});
