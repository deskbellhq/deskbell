# D12 — Multi-tenant from the first commit

**Decision.** The data model is **org → projects → sources**. Every table carries
`org_id`; every query is org-scoped; row-level security backs it at the database layer.
This is true from the first commit, before there is a second tenant.

**Why.** Retrofitting tenancy is one of the few genuinely unrecoverable architectural
mistakes. It is not a migration — it is an audit of every query in the codebase, where a
single missed `where` clause is a cross-tenant data leak that no test suite is likely to
catch. Adding the column now costs a column. Adding it later costs a rewrite plus the
uncertainty of never being quite sure you got them all.

The shape also matches how the product is actually deployed: one instance serving several
projects, and — for agencies and consultancies — several client organisations.

**What this rules out.** Unscoped table access, anywhere. Convenience queries that "only
run in the dashboard so it's fine". New tables without `org_id`.

**Where it bites in code.** `packages/db/src/schema.ts` (every table) ·
`packages/db/AGENTS.md` · scoped query helpers rather than raw table access ·
`apps/web/lib/abuse/client.ts` hashes raw IP addresses rather than storing them, because
tenant-scoped rows should not accumulate PII. Root `AGENTS.md` rule 3 states the invariant.

**Known deviation:** `rate_limits` currently has no `org_id` — rate limiting is
deliberately pre-tenant, since it must work before a request is attributed. Recorded in
`.ai/specs/2026-08-24-widget-abuse-protection.md`.
