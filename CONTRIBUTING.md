# Contributing to Deskbell

Thanks for considering it. The ground rules:

## Setup

```bash
pnpm dx   # Postgres via Docker + migrate + dev servers
```

Node ≥22, pnpm ≥10 (`corepack enable pnpm`).

## Workflow

1. **Spec first**: non-trivial features start as `.ai/specs/{YYYY-MM-DD}-{kebab-title}.md`. Look at existing specs for the shape.
2. Lint/format: `pnpm lint:fix` (Biome). Types: `pnpm typecheck`. Tests: `pnpm test`.
3. Keep PRs small and single-purpose.

## Boundaries that reviews enforce

- **License boundary**: nothing outside `packages/ee` may import from it except behind the documented feature gates. MIT packages (`widget-*`, `sdk`, `ui`, `shared`) must not import AGPL packages.
- **Tenancy**: every query is org-scoped; no unscoped table access.
- **Transport-neutral core**: `packages/core` must not know about HTTP/SSE/DOM.
- **Widget weight**: `widget-core` + deps ≤ 40KB gzip; nothing third-party beyond preact.

## CLA

A Contributor License Agreement will be required before the first public release (cla-assistant). By contributing before that, you agree to license your contribution under the repository's licenses.

## Conduct and security

The [code of conduct](./CODE_OF_CONDUCT.md) applies everywhere in the project. Vulnerabilities go to security@deskbell.dev, never to a public issue; see [SECURITY.md](./SECURITY.md).
