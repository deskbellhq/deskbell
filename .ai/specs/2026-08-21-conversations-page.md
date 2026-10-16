# 2026-08-21 — Conversations page: browse persisted widget sessions

**Goal**: make the conversations the ask endpoint persists visible in the dashboard.
`/conversations` lists every widget session for the project (first question,
message count, refusals, timestamps); clicking one opens the full transcript with
citations and refusal outcomes. This is the read side of the analytics contract noted in
spec: mvp-end-to-end ("citations/refused are the raw material for Gaps/Top questions").

## Scope

- `apps/web/app/(dashboard)/conversations/page.tsx` — list, newest first. Columns:
  first user question (preview, links to detail), messages, refusals, started,
  last activity. One aggregate query (leftJoin + groupBy); no N+1.
- `apps/web/app/(dashboard)/conversations/[id]/page.tsx` — transcript. Org+project-scoped
  lookup (D12); unknown/foreign id → `notFound()`. User messages right-aligned,
  assistant messages left with citation links; refusals surfaced as a badge, since a
  refusal IS the interesting datum (docs gap), not a failure to hide.
- Sidebar "Conversations" nav item goes live (`#` → `/conversations`).
- Overview "Recent conversations" table switches from `data.json` demo rows to the live
  latest-10 (same aggregate shape + last answer preview for the drawer, truncated to
  500 chars server-side). `data.json` deleted. The fabricated `confidence` column is
  dropped — the engine produces no confidence score; drawer's "Open in Conversations"
  now links to the transcript. Overview cards + chart stay demo (later analytics spec).

## Decisions

- **Server Components only, `force-dynamic`** — same pattern as Sources; no client JS,
  no polling. Refresh = reload (live updates belong to a later analytics spec).
- **First question via `array_agg(... order by created_at) filter (role='user')`** in the
  list aggregate — one pass, no correlated subquery, no second round trip.
- **Citations re-validated on read** with `CitationSchema.array().safeParse` — jsonb is
  typed `unknown[]` at the boundary; render only what parses instead of casting.
- **No pagination in MVP** — dev-scale data; becomes a follow-up alongside the
  Gaps/Top-questions pages when volume exists.

## Out of scope

Gaps + Top questions pages, feedback display/filters, search, retention purge job,
pagination, live refresh.
