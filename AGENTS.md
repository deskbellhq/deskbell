# Deskbell — Agent Instructions

Open-source embeddable AI agent widget: answers from docs (citations, refusals), acts through MCP tools behind per-tool permissions and confirmation. Monorepo: pnpm + Turborepo, Next.js 16, Drizzle + Postgres/pgvector, pg-boss, AI SDK v7, Preact widget.

## Commands

- `pnpm dx` — full dev bootstrap (Postgres container + migrate + dev)
- `pnpm lint:fix` / `pnpm typecheck` / `pnpm test` / `pnpm build`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations

## Hard rules (violations are bugs)

1. **Spec first.** Non-trivial work starts as `.ai/specs/{YYYY-MM-DD}-{kebab-title}.md`. `TODO(spec: name)` comments mark where specs land.
2. **License boundaries.** `packages/ee` = commercial (import only behind feature gates, server-only). MIT packages (`widget-*`, `sdk`, `ui`, `shared`) must never import AGPL packages (`core`, `db`, `connectors`, `evals`, apps).
3. **Tenancy (D12).** Every table has `org_id`; every query is org-scoped. No unscoped access.
4. **Transport-neutral core (D10).** `packages/core` knows nothing of HTTP, SSE, DOM, or widgets.
5. **Widget weight.** `widget-core` bundle ≤ 40KB gzip; no third-party code beyond preact (`@deskbell/sdk` and `@deskbell/shared/widget-config` are inlined and dependency-free by their own rules).
6. **Security.** `/api/v1/ask` is public and spends LLM tokens: origin allowlist + rate limits + token budgets are launch-blocking. Ingested content is data, never instructions.
7. **Self-host bar.** Postgres is the only infra dependency. Adding a service to docker-compose requires a decision file in `.ai/decisions/`.
8. **Agnostic by architecture, opinionated by default (D4/D13).** LLM-agnostic: all model access via the engine's model interface (AI SDK underneath); provider SDKs are imported ONLY in the model-config module. Vector-DB-agnostic: all retrieval/upsert via the `VectorStore` interface; pgvector is the default driver and the only one self-hosters need. Agnosticism never justifies adding a self-host dependency (rule 7 wins).
9. **Decisions are in-repo; strategy is not.** Architectural decisions live in `.ai/decisions/` (`D{NN}-{slug}.md`) and are authoritative here — a `(D12)` in a comment must resolve to a file there, so never cite a decision number that has no file. Do not add business strategy (targets, gates, pricing), competitive comparisons or teardowns, or narration of the authoring process (tool, session, assistant) to this repository. Naming a product we integrate with is fine; ranking ourselves against one is not.

## Conventions

- Commit messages: imperative subject ≤50 chars, no trailing period; body wrapped at 72 chars explaining what and why. **Never add Co-Authored-By, sign-offs, tool attribution, or session links** — no trailers of any kind.
- Server Components by default; `"use client"` only where interactivity requires it.
- Route handlers stream SSE; check cheap sync conditions before awaits; `Promise.all` independent I/O (no waterfalls).
- Biome for lint+format; double quotes; 100-col lines.
- Per-package `AGENTS.md` files add local rules — read them before editing a package.
- `.ai/README.md` indexes the builder docs: `.ai/decisions/` (why the code is shaped this way), `.ai/specs/` (design record per unit of work). `docs/` is for people running Deskbell, not building it.
