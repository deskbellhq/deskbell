# 2026-08-21 — Dashboard shell UI (shadcn blocks, v1-scope IA)

**Goal**: the dashboard and login UI skeleton, built from shadcn blocks (`dashboard-01`,
`login-01`) and adapted to Deskbell's information architecture. Static/demo data only —
auth wiring (better-auth), sources CRUD, and live analytics land with spec: dashboard-shell
(this spec is its UI half).

## IA (v1 scope mapped onto a sidebar)

Sidebar navigation:

| Item | v1 role | Backed by |
|---|---|---|
| Overview | KPI cards + questions chart + unanswered table | analytics (D8) |
| Sources | connector list, sync status, add source | `packages/connectors` |
| Playground | test questions against the engine | `/api/v1/ask` |
| Conversations | Q&A log with citations + feedback | core answer log |
| Gaps | unanswered questions / docs-gap analytics | the sales-doc analytics |
| Deploy | widget embed snippet, keys, origin allowlist | widget trilogy |
| Settings | project/org settings | better-auth org (later) |

Overview adapts `dashboard-01`: KPI cards = Conversations (7d) / Answered rate /
Deflection est. / Open docs gaps; chart = questions over time (answered vs unanswered);
table = recent conversations. Login page adapts `login-01` at `/login` (email+password,
better-auth wiring later).

## Rules

- Routes: `/login` + `/dashboard` (route group `(dashboard)` later if needed). Homepage
  stays the self-host landing card for now.
  - **Superseded 2026-08-24**: the `(dashboard)` route group landed and the `/dashboard`
    prefix is gone — Overview is now `/`, with `/sources`, `/appearance`, `/deploy`,
    `/conversations` beside it. The self-host landing card was deleted (it collided with
    Overview at `/`). `/login` stays outside the group so it renders without the sidebar.
- Block-derived app code lives in `apps/web/components/` and is OURS — adapted freely and
  held to normal lint rules (unlike vendored `packages/ui/src/components/`).
- Server Components by default; `"use client"` only where the block needs interactivity.
- Demo data is clearly fake (labeled), shaped like the real analytics payloads to come.
