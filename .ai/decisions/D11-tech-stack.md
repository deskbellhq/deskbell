# D11 — The stack, and the self-host bar that constrains it

**Decision.** TypeScript (strict, Node ≥22) · pnpm + Turborepo · Next.js 16 App Router ·
Drizzle + Postgres + pgvector · pg-boss · better-auth (SSO plugin in EE) · AI SDK v7 ·
`@modelcontextprotocol/sdk` · Preact shadow-DOM widget trilogy · Tailwind v4 + shadcn/ui
in the dashboard only · Biome · Vitest + Playwright.

**The bar every choice is measured against:** `docker compose up` must work with
**Postgres as the only infrastructure dependency.**

**Why.** A few of these are worth their reasons:

- **Drizzle** has native pgvector support — `vector()` columns, `cosineDistance()`, HNSW
  indexes declared in-schema. Embeddings are core to this product, and the alternative
  needs raw SQL and an unsupported-column escape hatch to do the same work.
- **pg-boss** rather than a Redis-backed queue keeps the compose file at app + Postgres.
  The throughput ceiling is far above anything this workload approaches.
- **Preact** for the widget because it is 4.84KB gzipped, which is what makes the ≤40KB
  total budget (D-adjacent, root `AGENTS.md` rule 5) achievable at all.
- **Shadow DOM** so a customer's CSS and Deskbell's cannot reach each other, with an
  iframe fallback for strict-CSP deployments.

The self-host bar is the real constraint. Every additional service in `docker-compose.yml`
is a thing self-hosters must run, monitor, back up, and upgrade forever — a tax paid by
every user so that one feature can be slightly easier to build.

**What this rules out.** Adding any service to `docker-compose.yml` without a decision
file here. Tailwind or shadcn inside the widget (see the budget above).

**Where it bites in code.** `docker-compose.yml` (web + worker + postgres, nothing else) ·
`apps/web/lib/abuse/rate-limit.ts` implements rate limiting in Postgres rather than
reaching for Redis · `packages/ui` is dashboard-only.
