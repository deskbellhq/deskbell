# 2026-08-20 — repo-scaffold

## Goal

Founding scaffold of the Deskbell monorepo per D11 — structure, license mechanics, interfaces, and self-host skeleton. No product features.

## Shipped in this spec

- pnpm + Turborepo monorepo; Biome; base tsconfig; CI workflow
- License mechanics: root AGPL + carve-out (ee commercial, embeddable packages MIT); `packages/ee` with LICENSE + FEATURES + server-only
- `packages/shared`: wire contracts (AskRequest, AnswerEvent, Citation)
- `packages/db`: Drizzle schema — orgs, projects (publicKey + allowedOrigins + dailyTokenBudget), sources, documents, chunks (pgvector + HNSW + embedding versioning), conversations, messages. org_id everywhere (D12)
- `packages/core`: transport-neutral `AnswerEngine` (D10) + `VectorStore` interface with pgvector driver (D12)
- `packages/connectors`: Connector interface + registry + docs-crawler stub
- `packages/evals`: golden-set harness skeleton (D8)
- Widget trilogy: snippet loader, shadow-DOM custom element (Preact), React wrapper; `sdk` SSE client
- `apps/web`: Next.js 16 standalone; /api/health; /api/v1/ask (SSE, origin-check v0)
- `apps/worker`: pg-boss queues (ingest.source, embed.chunks, reindex.embeddings, purge.conversations)
- docker-compose (web+worker+pgvector, localhost-bound db), Dockerfile (multi-target), `pnpm dx`
- Agent-native: root AGENTS.md/CLAUDE.md + per-package AGENTS.md (core, db, connectors, widget-core)

## Follow-up specs (referenced by TODO(spec: …) markers in code)

1. `model-config` — AI SDK provider wiring from env (D4), embed + generate implementations
2. `ingestion-pipeline` — crawler implementation, chunking, hashing, embedding, injection flagging
3. `widget-abuse-protection` — LAUNCH-BLOCKING: rate limits, token budgets, bot filtering
4. `hybrid-retrieval` — FTS leg + RRF + projectId filter + reranker; answer cache
5. `widget-chat-ui` — streaming chat in the panel, feedback buttons, i18n
6. `dashboard-shell` — auth (better-auth), sources CRUD, playground, analytics
7. `eval-harness` — LLM-judge groundedness, cross-language cases, CI report
8. `widget-js-api` — pre-ready command queue, programmatic open/ask
9. `worker-build` — proper build for the worker image (drop tsx in prod)
10. `rls-policies` — Postgres RLS migrations for tenant isolation

## Non-goals (deliberately absent)

- MCP actions (v2), helpdesk handoff (v2), multi-org management/SSO (EE, later)
- Tailwind/design system — arrives with dashboard-shell
