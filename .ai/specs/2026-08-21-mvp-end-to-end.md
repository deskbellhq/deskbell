# 2026-08-21 — MVP end to end: docs URL → ingest → widget → grounded answer

**Goal**: functional dev-first MVP. Paste a docs-site URL on the dashboard Sources page →
crawled → chunked → embedded (pgvector) → embed the widget via script snippet on `/demo` →
ask → streamed grounded answer with citations, honest refusal otherwise.

## Scope map (against the scaffold's follow-up spec names)

| Follow-up spec | This spec delivers | Still open |
|---|---|---|
| `model-config` | ✔ AI SDK provider wiring from env; OpenAI implemented | Anthropic/Ollama cases (one switch arm each) |
| `ingestion-pipeline` / `docs-crawler` | ✔ crawler (sitemap+BFS), extraction, chunking, hashing, embedding | injection flagging at ingest, stale-doc sweep, gzipped/nested sitemaps |
| `widget-chat-ui` | ✔ streaming chat, citations, session persistence, Esc/focus | feedback buttons, i18n |
| `dashboard-shell` | ✔ Sources page (list/add/sync) + dashboard layout | auth (better-auth), playground, live analytics |
| `hybrid-retrieval` | ✔ projectId filter only (early-pull, correctness) | FTS leg, RRF, reranker, answer cache |
| `widget-abuse-protection` | — (origin check v0 unchanged) | **LAUNCH-BLOCKING before any public deploy** |
| `widget-js-api`, `worker-build`, `rls-policies`, `eval-harness` | — | open |

## Decisions

- **OpenAI default** via AI SDK (`DESKBELL_CHAT_MODEL=openai/gpt-5-mini`,
  `DESKBELL_EMBEDDING_MODEL=openai/text-embedding-3-small`); `provider/model` string parsed
  in the model-config module. Model-agnosticism (D4/D13) preserved: provider SDKs live ONLY
  in `packages/core/src/models/` (subpath export `@deskbell/core/models`, never re-exported
  from the engine barrel).
- **No auth in MVP**: idempotent seed creates `org_dev` / `proj_dev` / key `pk_dev_default`
  with empty `allowedOrigins` (fail-open — dev-only; hard gate lands with
  widget-abuse-protection). Dashboard resolves the first project server-side.
- **Doc identity** = `(orgId, sourceId, url)` — the docs-crawler's `externalId` IS the
  normalized URL; `documents` has no separate externalId column.
- **`done` event now always emitted** (also after refusal) carrying the persisted
  assistant `messageId`. Additive to the wire contract.
- **Refusals persisted** (`messages.refused`) from day one — the seed of the docs-gap /
  coverage analytics (v1 scope — see `ROADMAP.md`). Retrieval is
  single-pass in MVP; query-expansion loop belongs to `hybrid-retrieval`.
- **cheerio** in `packages/connectors` (spec-compliant HTML parse, XML mode for sitemaps).
  Server-only AGPL package — bundle budget not in play.
- **Widget bundle**: esbuild IIFE from `widget-snippet` (`dist/widget.js`), gzip size gate
  **fails the build > 40KB** (AGENTS rule 5, now mechanical). widget-core runtime deps:
  preact only; `@deskbell/shared` types are imported type-only (erased). Served by
  `apps/web/app/widget.js/route.ts` (resolve → read → text/javascript).
- **CORS**: POST responses echo allowed origin (`*` when allowlist empty — documented
  fail-open); OPTIONS preflight is 204/permissive because it cannot be project-scoped —
  the POST-side origin check is the boundary.
- **Sources → analytics contract note**: conversation rows created per widget session;
  `messages.citations`/`refused` are the raw material for Gaps/Top questions pages later.

## Out of scope (unchanged commitments elsewhere)

Write actions (v3 + D7), helpdesk features (D5), multi-tenant cloud, voice (D10/v4),
FTS/RRF, evals in CI (D8 spec pending), RLS, worker prod build.
