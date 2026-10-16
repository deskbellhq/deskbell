# apps/docs — Agent Instructions

The public documentation site, served at `deskbell.dev/docs`. Fumadocs on
Next.js 16, Tailwind v4, content in `content/docs`.

Read the root `AGENTS.md` first. Rule 9 applies here more than anywhere else in
the repository: this is the most public surface it has.

## Audience

People **running** Deskbell or **embedding** the widget. Not people building it,
whose record is `.ai/`. If a page would only make sense to someone editing
`packages/core`, it belongs in a spec instead.

`.ai/specs/` and `.ai/decisions/` never appear in site navigation.

## Structure

One sidebar, seven unlinked section headers, in the order a reader meets the
product: **Start · Deploy · Knowledge · Widget · Operate · Manage ·
Developer**. Each section is a folder extracted into the root list
(`"...deploy"` in `content/docs/meta.json`), so files slug under the folder and
list flat under the header.

- A section's first page is `index.mdx`: an overview of what the section
  covers and where each page fits. It says `sidebarTitle: Overview`.
- A section with recurring questions ends with `faq.mdx`, or
  `troubleshooting.mdx` in Deploy.
- Sidebar labels are short nouns. When the title is a sentence, set
  `sidebarTitle`.
- `widget/configuration` is the one real (collapsible) folder; its `index.mdx`
  is the folder's own page and is not listed in its `meta.json`.
- A page that moves gets a permanent redirect in `redirects.mjs`.

`lib/page-tree.test.ts` and `lib/redirects.test.ts` pin all of this. The
builder is forgiving: an entry that resolves to nothing is dropped, an
unlisted page falls out of the sidebar and `llms.txt`. The tests are what
notice.

## Every page

Frontmatter is a contract, enforced at build by `lib/frontmatter-schema.ts`:

```yaml
---
title: Environment variables
sidebarTitle: Environment variables   # optional: the short noun for the sidebar
description: One standalone sentence, over 40 characters, not the title. Answer engines extract descriptions on their own.
updated: YYYY-MM-DD
---
```

`updated` records when the page was last checked against the code. It feeds
the sitemap and the frontmatter test and is not shown on the page. Bump it
when you revise the page, not when you fix a typo.

There is no status field. A page describes what the software does; work that
has not shipped is not on the site. Limits are documented as facts under a
`Limits` or `Scope` heading ("One issuer per project"), never as things that
are missing. `lib/frontmatter.test.ts` refuses a `status` key and the words
`pre-alpha`, `alpha`, `beta`, `not built`, `not yet`, `coming soon` and
`experimental` in page bodies. Avoid `today` and `yet` as qualifiers for the
same reason: the sentence should stay true when the code changes.

There is no roadmap page here. The future lives in `ROADMAP.md` at the
repository root and on the marketing site's roadmap section; `/roadmap`
redirects there.

## Facts come from the source, never from memory

Every page maps to files in this repository. Before editing a page, re-read what
it documents:

| Page | Source of truth |
|---|---|
| `index`, `quickstart`, `deploy/index`, `deploy/docker-compose` | `docker-compose.yml`, `Dockerfile`, `scripts/dx.sh` |
| `deploy/requirements`, `deploy/upgrading` | `docker-compose.yml`, `Dockerfile`, `packages/db/migrations`, `packages/db/drizzle.config.ts` |
| `deploy/environment-variables` | `.env.example`, `apps/web/lib/abuse/config.ts`, `packages/core/src/retrieval/config.ts` |
| `deploy/models` | `packages/core/src/models/index.ts` |
| `deploy/vector-store` | `packages/core/src/retrieval/factory.ts`, `packages/core/src/retrieval/weaviate.ts`, `scripts/vector-store-prune.ts`, `apps/web/app/(dashboard)/sources/page.tsx` |
| `deploy/commands` | root `package.json` scripts, `scripts/*.ts` headers |
| `deploy/troubleshooting` | `apps/web/lib/widget-guard.ts`, `docker-compose.yml`, the worker handlers |
| `knowledge/*` | `packages/connectors/src/docs-crawler`, `packages/core/src/ingest`, `apps/worker/src/handlers/ingest-source.ts`, `apps/web/app/(dashboard)/sources` |
| `knowledge/clarifying-questions` | `packages/core/src/engine.ts` (`CLARIFY_PROMPT`, `parseClarify`), `packages/core/src/clarify-config.ts`, `apps/web/app/api/v1/ask/route.ts`, `packages/widget-core/src/panel.tsx`, `packages/evals/src/run.ts` |
| `how-it-works` | `packages/core/src/engine.ts` |
| `widget/*` | `packages/shared/src/widget-config.ts`, `packages/widget-snippet`, `packages/widget-core/src/index.ts` |
| `widget/install/*` (per platform) | A real install on that platform against a running instance, re-run when the loader changes; the page names the version it was verified with |
| `actions/*` | `packages/shared/src/actions.ts`, `packages/core/src/engine.ts` (tools, holds, `TOOLS_PROMPT`), `packages/core/src/models/index.ts` (tool mapping, approvals), `apps/web/lib/actions/`, `apps/web/app/settings/actions/`, `apps/web/app/api/v1/ask/route.ts`, `apps/web/app/api/v1/actions/jwks/route.ts` |
| `widget/identity` | `apps/web/lib/identity/`, `apps/web/lib/conversation-access.ts`, `apps/web/app/settings/identity/`, `packages/shared/src/index.ts` |
| `operate/index`, `operate/conversations` | `apps/web/app/(dashboard)/page.tsx`, `apps/web/components/section-cards.tsx`, `apps/web/app/(dashboard)/conversations`, `apps/web/lib/thread-status.ts`, `apps/web/lib/onboarding.ts` |
| `operate/gaps` | `apps/web/app/(dashboard)/gaps`, `apps/web/app/settings/gaps`, `apps/web/lib/gaps*.ts`, `packages/db/src/gaps.ts`, `apps/worker/src/handlers/{assign-gap-cluster,gaps-catchup,analyze-gap-cluster}.ts`, `packages/core/src/models/gap-analyst.ts` |
| `operate/notifications` | `packages/shared/src/notifications.ts`, `apps/worker/src/notifications/`, `apps/worker/src/handlers/deliver-notification.ts`, `apps/web/app/settings/notifications/` |
| `operate/evaluation` | `packages/evals`, `scripts/run-evals.ts`, `scripts/sweep-evals.ts` |
| `manage/index`, `manage/members-and-roles`, `manage/authentication` | `apps/web/lib/auth.ts`, `apps/web/lib/auth/hooks.ts`, `apps/web/lib/auth/config.ts`, `apps/web/lib/auth/permissions.ts`, `apps/web/app/settings/members/`, the `checkRole`/`requireRole` calls in every `actions.ts` |
| `manage/security` | `apps/web/lib/widget-guard.ts`, `apps/web/lib/abuse/` |
| `manage/data-retention` | `packages/db/src/retention.ts`, `apps/worker/src/handlers/purge-conversations.ts`, `apps/web/app/settings/retention/` |
| `developer/api`, `developer/sdk` | `apps/web/app/api/v1/**`, `apps/web/lib/widget-guard.ts`, `packages/shared/src/index.ts`, `packages/sdk/src/index.ts` |
| `developer/contributing`, `developer/licensing` | `CONTRIBUTING.md`, `LICENSING.md`, `packages/ee/FEATURES`, `packages/ee/LICENSE` |

If a page and the code disagree, the code is right.

## The widget reference is not written by hand

`components/widget-reference.tsx` renders options, tokens, parts and slots from
`@deskbell/shared/widget-config`, the same descriptor the widget itself reads.
Never type an option into a table. Add it to the descriptor and it appears.

`docs/widget-customization.md` at the repository root is a separate generated
artifact for people reading a checkout. It is byte-compared in CI. Nothing here
reads or writes it.

## Diagrams are data

`<Flow name="…" />` draws a diagram defined in `lib/diagrams.ts`: nodes on a
grid, labelled edges, lanes as bands. `components/flow.tsx` lays it out and
emits inline SVG in `currentColor`, so it follows both themes with no image
and no runtime. Add a diagram by adding an entry to the data file, not by
pasting SVG or a Mermaid fence (nothing renders Mermaid here). Keep labels to
a few words; the caption carries the sentence. `lib/diagrams.test.ts` checks
that edges name real nodes, cells hold one node, and labels stay short.

## Format

Prefer `.md` so pages stay readable on GitHub. Reach for `.mdx` only when a page
needs components. Available without importing: `Callout`, `Steps`/`Step`,
`Tabs`/`Tab`, `Accordions`/`Accordion`, `Cards`/`Card`, `Files`/`File`/`Folder`,
`Flow`, and the widget reference components.

MDX parses `<...>` as JSX, so bare autolinks like `<https://example.com>` break
the build. Use `[text](url)`.

## Writing

Technical documentation, so neutral and second person. No personality, no
opinions, no sales language.

- Lead each section with the answer, then explain. Do not announce what you are
  about to say.
- Keep the opening of a page to 40 to 60 words and self-contained. It should
  make sense pasted alone into a chat window.
- Headings phrased the way people ask: "How do I use a local model?" rather than
  "Model configuration". Sentence case.
- Tables for comparison, numbered lists for process.
- Concrete measured numbers where they exist. They are the most useful thing on
  a page and the most likely to be cited.
- No em dashes or en dashes. Use commas, colons, parentheses, or two sentences.
- State what a thing does. Do not describe what it used to do; this is
  documentation, not a changelog.
- Name the limits. A page that omits what does not work is the kind of
  documentation this project exists to be better than.

## Routing, and the two ways it breaks silently

`basePath: "/docs"` prefixes every route. Both failures below look like a
working site:

1. Pages mount at the **app root** (`app/[[...slug]]`). A directory named
   `app/docs/` would serve at `/docs/docs/…`.
2. The search dialog fetches from the browser and a client fetch does **not**
   inherit `basePath`. `lib/shared.ts` exports `searchApiUrl` for this.

Edit links carry the full monorepo path
(`apps/docs/content/docs/`). A framework default assuming the repository root
produces a link that 404s on every page.

All three are pinned by tests in `lib/`, as is the redirect table. Run
`pnpm --filter @deskbell/docs test`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
