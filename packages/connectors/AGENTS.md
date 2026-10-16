# @deskbell/connectors

One folder per connector. Anatomy (fixed):
- `index.ts` exporting a `Connector` object: `type`, `displayName`, `configSchema` (zod), `discover(config): AsyncIterable<RawDocument>`
- Register it in `../index.ts` `connectorRegistry`

Rules:
- Connectors only DISCOVER documents. Chunking, hashing, embedding, storage = worker's job.
- No cross-connector imports. Shared helpers go to the package root only when 3+ connectors need them.
- Emitted content is treated as untrusted data downstream — do not "clean" instruction-like content here, flag it (see spec: ingestion-pipeline).
- Respect robots.txt and rate-limit external fetches.
