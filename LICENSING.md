# Licensing

Deskbell is one repository under three licences. This file is the authoritative
map; every directory below also carries its own `LICENSE` file.

## The map

| Path | Licence | What it is |
|---|---|---|
| `apps/web`, `apps/worker` | AGPL-3.0-only | The dashboard, API and background worker — the server you run |
| `packages/core` | AGPL-3.0-only | The answering engine: retrieval, grounding, citations, refusals |
| `packages/connectors` | AGPL-3.0-only | Ingestion: docs crawler, help centres, Confluence, GitHub, Discord |
| `packages/db` | AGPL-3.0-only | Drizzle schema, Postgres + pgvector, migrations |
| `packages/evals` | AGPL-3.0-only | The answer-quality eval harness |
| `packages/widget-core` | MIT | The embeddable widget (Preact, shadow DOM), published as `@deskbell/widget` |
| `packages/widget-snippet` | MIT | The loader script, served by the app as `deskbell.js` (not published) |
| `packages/widget-react` | MIT | React wrapper |
| `packages/sdk` | MIT | Typed API client, published as `@deskbell/sdk`; the widget runs on it |
| `packages/ui` | MIT | Dashboard component library |
| `packages/shared` | MIT | Types, schemas, constants, published as `@deskbell/shared` |
| `packages/ee` | Commercial | Enterprise Edition — see `packages/ee/LICENSE` and `packages/ee/FEATURES` |

Third-party components keep the licence granted by their own authors.

The `license` field in each package's `package.json` matches this table and is
what dependency scanners read.

## If you are embedding Deskbell in your product

Everything you ship to your users is MIT: the widget, the loader, the React
wrapper and the SDK. They talk to your Deskbell server over HTTP. **Nothing in
your application links against AGPL code, so the AGPL places no obligation on
your own source.**

## If you are self-hosting the server

Running Deskbell unmodified carries no obligation beyond passing the licence
along. If you *modify* the AGPL-licensed parts and let users interact with your
modified version over a network, AGPL-3.0 section 13 requires you to offer those
users the corresponding source of your modified version.

If you would rather modify Deskbell and keep those changes private, that is what
a commercial licence is for. Get in touch.

## What is, and is not, Enterprise Edition

`packages/ee` is commercially licensed and contains operations and compliance
features only — multi-organisation management, SSO/SCIM provisioning, custom
roles, audit logging and white-label rights. The exact list is enumerated in
`packages/ee/FEATURES`.

**The answering core is never Enterprise Edition.** Retrieval, grounding,
citations, refusal behaviour, every ingestion connector, the eval harness and
docs-gap analytics are AGPL and stay that way. If that boundary ever moves, it
moves as a commit in this file and in `packages/ee/FEATURES`, in public.

## Questions

Open an issue, or email hello@deskbell.dev for commercial licensing.
