import type { Database } from "@deskbell/db";
import { createPgVectorStore, PGVECTOR_STORE_ID } from "./pgvector";
import type { VectorStore } from "./vector-store";
import {
  createWeaviateVectorStore,
  WEAVIATE_DEFAULT_COLLECTION,
  type WeaviateConfig,
  weaviateStoreId,
} from "./weaviate";

/**
 * Which driver retrieval runs on, from the environment (spec:
 * weaviate-vector-store):
 *
 *   DESKBELL_VECTOR_STORE   pgvector (default) | weaviate
 *   WEAVIATE_URL            http(s)://host:port — required for weaviate
 *   WEAVIATE_GRPC_URL       gRPC endpoint; default: the same host on 50051
 *   WEAVIATE_API_KEY        optional
 *   WEAVIATE_COLLECTION     default DeskbellChunk
 *
 * Every process that retrieves or ingests resolves the driver here, so the
 * web app, the worker and the scripts cannot disagree on where chunks live.
 * Unlike the retrieval knobs, a bad value here throws: an operator who typed
 * `weviate` must not quietly run pgvector and find out the day the two
 * indexes disagree.
 */
export type VectorStoreConfig =
  | { driver: "pgvector" }
  | { driver: "weaviate"; weaviate: WeaviateConfig };

export function vectorStoreConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VectorStoreConfig {
  const raw = env.DESKBELL_VECTOR_STORE?.trim().toLowerCase();
  if (raw === undefined || raw === "" || raw === "pgvector") return { driver: "pgvector" };
  if (raw !== "weaviate") {
    throw new Error(
      `DESKBELL_VECTOR_STORE="${env.DESKBELL_VECTOR_STORE}" — expected pgvector or weaviate`,
    );
  }
  const url = env.WEAVIATE_URL?.trim();
  if (!url)
    throw new Error("DESKBELL_VECTOR_STORE=weaviate needs WEAVIATE_URL (http(s)://host:port)");
  try {
    new URL(url);
  } catch {
    throw new Error(`WEAVIATE_URL="${url}" is not a URL — expected http(s)://host:port`);
  }
  const grpcUrl = env.WEAVIATE_GRPC_URL?.trim();
  const apiKey = env.WEAVIATE_API_KEY?.trim();
  const collection = env.WEAVIATE_COLLECTION?.trim();
  if (collection && !/^[A-Z][_0-9A-Za-z]*$/.test(collection)) {
    throw new Error(
      `WEAVIATE_COLLECTION="${collection}" — a collection name starts with a capital letter and has only letters, digits and underscores`,
    );
  }
  return {
    driver: "weaviate",
    weaviate: {
      url,
      ...(grpcUrl ? { grpcUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      collection: collection || WEAVIATE_DEFAULT_COLLECTION,
    },
  };
}

/**
 * What the configured driver writes to `chunks.vector_store` — without
 * building it. Rows marked with anything else were indexed by a store that
 * is no longer configured (spec: vector-store-single-home).
 */
export function vectorStoreId(config: VectorStoreConfig = vectorStoreConfigFromEnv()): string {
  switch (config.driver) {
    case "pgvector":
      return PGVECTOR_STORE_ID;
    case "weaviate":
      return weaviateStoreId(config.weaviate.collection);
  }
}

/** The configured driver over this database — the one way to build a store. */
export function createVectorStore(
  db: Database,
  config: VectorStoreConfig = vectorStoreConfigFromEnv(),
): VectorStore {
  switch (config.driver) {
    case "pgvector":
      return createPgVectorStore(db);
    case "weaviate":
      return createWeaviateVectorStore(db, config.weaviate);
  }
}
