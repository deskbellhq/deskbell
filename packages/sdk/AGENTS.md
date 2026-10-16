# @deskbell/sdk

The typed client for the public API. MIT; ships inside customers' bundles, and
the widget is inlined on top of it (spec: sdk-client).

Rules:
- No runtime dependencies. Types from `@deskbell/shared` are `import type` only,
  so zod never reaches a consumer.
- No DOM. `fetch`, `ReadableStream`, `TextDecoder` and `AbortSignal` are the whole
  platform surface; anything browser-only belongs in the widget.
- One method per public endpoint, and only for endpoints the server answers today.
- A non-2xx response is a `DeskbellError` with the status and `retry-after`; never
  swallow, never retry.
- Never import AGPL packages (`core`, `db`, `connectors`, `evals`, apps).
