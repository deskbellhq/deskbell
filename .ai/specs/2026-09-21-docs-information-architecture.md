# Documentation information architecture

> Status: done · 2026-09-21
> Amends: 2026-08-25-docs-site (navigation, frontmatter contract, the status ledger)

**Goal.** The docs site grew page by page to 22 pages in one flat list with two
unlabelled groups, and it carried a maturity system of its own: a `status` field on
every page, a badge in the sidebar and page header, a `pre-alpha` pill in the
navigation bar, and a Status page transcribed from `ROADMAP.md`. Three things went
wrong with that. The badge on a page says the page is unfinished when what was meant
is that the product area is; readers took it the first way. The ledger drifted from
the code within weeks (it still called the SDK partial after the SDK wrapped every
endpoint, and two pages still said hybrid retrieval and gap analytics were not built
after both shipped). And a reader looking for "how do I add a member" had no section
to look in, because pages were ordered by when they were written.

This spec replaces the flat list with sections, removes every maturity marker, and
sets the rule that keeps both from returning: **a page describes what the software
does. Work that has not shipped is not on the site.**

## Design

### Sections

One sidebar, seven unlinked section headers, in the order a reader meets the product:

| Section | Folder | What belongs there |
|---|---|---|
| Start | (root) | What it is, the quickstart, how it works, the roadmap |
| Deploy | `deploy/` | Everything an operator does before and after `docker compose up` |
| Knowledge | `knowledge/` | What Deskbell answers from and how it is ingested |
| Widget | `widget/` | Everything a page author does |
| Operate | `operate/` | The dashboard surfaces used after launch: conversations, gaps, notifications, evaluation |
| Manage | `manage/` | Workspace, members, authentication, security |
| Developer | `developer/` | The HTTP API, the SDK, contributing, licensing |

Rules, pinned by `lib/page-tree.test.ts`:

- Each section folder's first page is `index.mdx`, titled as an overview of the section.
  A reader who lands on a section header has one page that explains what the section
  covers before the pages that go deep. Operate's overview is the dashboard page,
  Manage's is the workspace page.
- Where a section has recurring questions, the last page is `faq.mdx` (or
  `troubleshooting.mdx` in Deploy, where the questions are failures rather than
  questions).
- Sections are fumadocs extracted folders (`"...deploy"` in the root `meta.json`):
  the files live in the folder and slug under it, the sidebar shows them flat under
  the header. The one real (collapsible) folder is `widget/configuration`, whose
  `index.mdx` is the folder's own page.
- Sidebar labels are short nouns. A page whose `title` is a sentence sets
  `sidebarTitle` to the noun; the loader plugin in `lib/source.tsx` applies it.
- Every content page is referenced by exactly one `meta.json` entry. An unreferenced
  page still renders but falls out of the sidebar and `llms.txt` silently.

### Frontmatter

```yaml
---
title: Environment variables
sidebarTitle: Environment variables   # optional; only when title is not the label
description: One standalone sentence, over 40 characters, not the title.
updated: 2026-09-21
---
```

`status` is gone from the schema. The schema strips unknown keys rather than
rejecting them, so a leftover `status:` line would vanish without a build error;
`lib/frontmatter.test.ts` asserts no page carries the key.

### Vocabulary

The same test scans page bodies for maturity vocabulary: `pre-alpha`, `alpha`,
`beta`, `not built`, `not yet`, `coming soon`, `experimental`. Limits are still
documented, as facts under a `Limits` or `Scope` heading: "One issuer per project"
rather than "multiple issuers are not supported yet". The difference is that the
first sentence stays true when the second one changes.

### Redirects

Every slug that moved gets a permanent redirect in `apps/docs/redirects.mjs`, which
`next.config.mjs` reads. Next prepends `basePath` to both sides, so entries are
written without `/docs`. Redirects run before routing, so `lib/redirects.test.ts`
asserts no source is a live slug and every destination is one.

| From | To |
|---|---|
| `/status` | `/` |
| `/self-hosting/configuration` | `/deploy/environment-variables` |
| `/self-hosting/:path*` | `/deploy/:path*` |
| `/sources/crawler` | `/knowledge/website` |
| `/sources/reindexing` | `/knowledge/re-indexing` |
| `/sources/:path*` | `/knowledge/:path*` |
| `/widget/customization` | `/widget/configuration` |
| `/widget/sdk` | `/developer/sdk` |
| `/docs-gaps` | `/operate/gaps` |
| `/notifications` | `/operate/notifications` |
| `/evaluation` | `/operate/evaluation` |
| `/security` | `/manage/security` |
| `/contributing` | `/developer/contributing` |

Slugs pinned from outside the docs app and therefore kept: `/widget/install`
(`apps/web/lib/widget-snippet.test.ts`), `/widget/identity` (emitted by
`scripts/gen-widget-docs.ts`), `/quickstart#common-problems` (dashboard link).
Dashboard links in `apps/web/lib/links.ts` and the Install page follow the moves.

### The roadmap

The one page about the future. It renders a board from `lib/roadmap.ts`: four
columns (shipped, next, later, not planned), one card per capability, and on
cards that have a GitHub discussion open, a link to it, where a thumbs-up is the
vote. Cards get links as discussions are opened; the data file is the place to
add them. `lib/roadmap.test.ts` keeps the columns non-empty, titles unique and
links `https`. The board and `ROADMAP.md` say the same thing in two forms and
are kept in step by hand.

### New pages

Written from the code in this change, because the surface existed and the docs did
not: Deploy overview · Upgrading and backups · Commands · Troubleshooting · Knowledge
overview · Knowledge FAQ · Widget overview · Widget FAQ · Dashboard · Conversations ·
Workspace · Members and roles · Authentication · HTTP API · Licensing. The 441-line
customization page is split into Options, Theming, Behaviour and JavaScript API. The
Start section gains the Roadmap.

`docker-compose.yml` gains `ANTHROPIC_API_KEY` and `OLLAMA_BASE_URL` passthrough for
`web` and `worker`; three pages described the missing passthrough as a step to work
around, and a four-line fix beats a paragraph.

## Not written, and why

- **Per-platform install guides** (one page per docs framework or CMS). Each needs a
  working install on that platform before it can be honest.
- **OpenAPI document.** The HTTP API page is written by hand from the zod schemas in
  `packages/shared`. Generating a spec from them is the next step; the page is the
  contract until then.
- **Screenshots.** None exist. They need a demo project with content that can be
  published.
- **One page per connector.** There is one connector. The Knowledge overview lists
  source types; a page per type follows the type.
- **Releases.** No package has been published. A releases page follows the first
  publish.
- **Retention.** `purge.conversations` is registered and logs only. No page describes
  retention until the job deletes rows.

## Resolved later the same day

- `Last updated` no longer renders in the page header. `updated` stays in the
  frontmatter contract: it feeds the sitemap's `lastModified` and the audit test,
  which is what it was for. A visible date made every page look stale on the day
  it was not touched, and said nothing about whether the content was checked.
