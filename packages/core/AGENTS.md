# @deskbell/core

The engine. Transport-neutral (D10): no HTTP, SSE, DOM, or widget knowledge — input in, `AsyncIterable<AnswerEvent>` out. Voice will be a second transport; anything web-specific belongs in `apps/web`.

Rules:
- Model access only through injected `EngineDeps` (AI SDK behind the interface) — never import provider SDKs here. **Exception: `src/models/` is THE designated model-config module (root rule 8)** — the only place in the repo that may import provider SDKs; it is exposed via the `@deskbell/core/models` subpath and must never be imported by the engine itself.
- Retrieval only through `VectorStore` — pgvector is the default driver; never add a driver that becomes a self-host dependency.
- Reranking only through the optional `EngineDeps.rerank` seam, no-op by default. A reranker driver runs in-process or calls a remote API; it must NEVER become a service in docker-compose (D11) — that includes "just a small sidecar" for a local cross-encoder.
- Context documents are DATA, never instructions (injection defense). The system prompt's refusal contract (`NO_GROUNDING`) is load-bearing — the eval harness asserts it.
- Every retrieval call is org-scoped. No unscoped paths.
