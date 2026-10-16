# D10 — The engine is transport-neutral; the widget is one transport

**Decision.** `packages/core` holds the whole agent — ingest, chunk, embed, retrieve,
ground, cite, refuse — and knows nothing about HTTP, SSE, the DOM, or widgets. Its
interface is messages in, answers plus citations plus actions out. The web widget is
transport #1, not the product boundary.

**Why.** The same engine will eventually answer through more than a chat bubble: a
headless client, an MCP server exposing "ask the docs" as a tool for other agents, and
plausibly voice. Each of those is a different transport over an identical brain.
Retrofitting channel-neutrality onto a core that grew up assuming a browser is not a
refactor, it is a rewrite — the web assumptions end up load-bearing in retrieval and
prompt construction, far from where they were introduced.

Keeping the boundary honest from the start also makes the engine testable without a
browser, which is what makes D8's harness cheap to run.

**What this rules out.** `packages/core` importing anything web-shaped: request objects,
streaming primitives, DOM types, widget config. Answer logic living in a route handler
because it was quicker.

**Where it bites in code.** `packages/core/src/engine.ts` (the transport-neutral entry
point) · `packages/core/AGENTS.md` · route handlers in `apps/web/app/api/v1/` are thin
adapters that stream what the engine returns · `packages/sdk` and `packages/widget-core`
are consumers, not participants. Root `AGENTS.md` rule 4 states the invariant.
