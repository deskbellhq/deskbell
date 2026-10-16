# @deskbell/db

Drizzle schema + Postgres (pgvector). Multi-tenant from row one (D12).

Rules:
- Every table carries `org_id` + an index on it. Documented exceptions only: `rate_limits` (pre-attribution), `signing_keys` (the deployment's own token-signing keys) and the auth tables in `src/auth-schema.ts` (identity precedes tenancy; `members` carries the org link).
- Schema changes: edit `src/schema.ts` → `pnpm db:generate` → review the generated SQL → commit both. Never hand-edit applied migrations.
- RLS policies live in SQL migrations alongside the tables they protect.
- Auth table SHAPE belongs to better-auth (spec: dashboard-auth): their drizzle definitions live in `src/auth-schema.ts`, mirror the installed better-auth version field-for-field, and migrate through the same journal. Diff against the library on upgrades; never redesign them by hand, and never add auth tables to `src/schema.ts`.
- Embedding column dimension changes require a `reindex.embeddings` migration path, never an in-place alter.
