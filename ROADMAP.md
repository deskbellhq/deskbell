# Roadmap

> The arc below is what Deskbell is being built toward, not a set of
> promises with dates. Order changes as we learn; scope lines are firmer than timing.
> What is *out* of scope is as load-bearing as what is in — see D5.

## Where v1 actually stands today

Where v1 stands, area by area:

| Area | State |
|---|---|
| Docs-site crawler → chunk → embed → store | **works** |
| Grounded answers with citations and refusals | **works** |
| Clarifying questions when the retrieved pages answer a question in more than one way | **works**, off by default — `DESKBELL_CLARIFY=on`; options are always retrieved page titles, asked at most once per conversation |
| Embeddable widget (shadow DOM, brandable) | **works** |
| Dashboard: Sources, Conversations, Appearance, Install, Members | **works** |
| Dashboard authentication (email+password, invitation-only membership, roles) | **works** |
| Sign in with Google (optional, env-gated; invited or allowed-domain members) | **works** — a login method, not identity-provider SSO (that stays in `packages/ee`) |
| `docker compose up` self-host | **works** |
| Widget abuse protection (origin binding, rate limits, token budgets) | **works** |
| End-user identity (OIDC bearer per project, conversations owned by the signed-in visitor, context, staff read-only preview) | **works** — the read-only half of the v2 identity binding (D16) |
| Widget modes and content (inline mode, Markdown answers, welcome cards, configurable feedback reasons, thread sidebar, draggable launcher) | **works** |
| Eval harness | **works** — runs in CI on a fixture set; real-corpus and LLM-judge runs are opt-in |
| Headless client / SDK-only usage | **works** — `@deskbell/sdk` wraps every public endpoint and the widget runs on it; installable from npm with `@deskbell/widget` |
| Hybrid retrieval (vector + FTS + fusion) | **works**, off by default — measured against the vector-only default and not adopted |
| Weaviate as the vector store (optional driver for a cluster you already run) | **works** — `DESKBELL_VECTOR_STORE=weaviate`; pgvector stays the default and the only driver the install needs |
| Gap & unanswered-question analytics | **works** — clusters by meaning, period + trend, resolve/reopen, analysis, CSV + dataset export |
| Notifications (Slack incoming webhook, signed JSON webhook) on negative feedback | **works** — per-channel event toggles, custom Slack message, conversation-link template; more events land as union members |
| Actions through MCP (servers attached per project, per-tool off / allowed / needs-confirmation, confirmation card, signed visitor identity token, audit table with an actions log page + CSV) | **works** — the D7 model: identity binding, per-tool permissions, confirmation flows and audit logging; every tool is off until an admin chooses |
| Conversation retention (a window in days per project; the worker removes older conversations hourly, messages and tool calls included) | **works** — off by default; the settings page names what a window would remove before it is saved |
| Connectors beyond the docs crawler | not built |
| Several projects in one workspace (one dashboard, one docs site and widget per project, a project switcher) | not built — the data model is org → projects → sources from the first commit (D12) and the free edition has no project cap, but the dashboard still opens the oldest project and offers no way to create another |
| Several organisations on one instance (agencies: one install, many clients) | not built — Enterprise edition, see `packages/ee/FEATURES` |
| Retrieval endpoint and an MCP server for the indexed docs (the matching chunks with their source pages, for agents and UIs you build) | not built — today the public API answers; it does not hand back the chunks |
| Row-level security | not built (org scoping is enforced in query helpers — see D12) |

## The arc

*"In scope" means the version is not complete without it — not that it exists today. What
exists today is the table above.*

### v1 · Answer

**In scope.** Ingestion from docs sites, help centers, Confluence, GitHub (READMEs and
issues), Discord and Slack threads · grounded retrieval with citations and honest
refusal · headless, brandable widget (web component + React wrapper) · docs-gap and
unanswered-question analytics · eval harness running on replayed real questions ·
`docker compose up` install · model-agnostic.

**Explicitly out.** Any write actions · helpdesk features (ticketing, inbox) ·
multi-tenant cloud.

### v2 · Actions

**In scope.** MCP tools (order status, subscription lookup, account info, and the
writes a server exposes) behind per-tool permissions and a confirmation step · end-user
identity binding · human-handoff into existing helpdesks (Zendesk, Gorgias, email) ·
white-label rights for agencies.

**Explicitly out.** Autonomous email handling · actions outside MCP (D4).

### v3 · Resolution

**In scope.** Procedures engine · audit log retention and export (EU AI Act Art. 12-grade) ·
resolution-rate analytics · autonomous email channel.

**Explicitly out.** Building our own helpdesk. Deskbell overlays — always (D5).

Write-capable tools ship behind the confirmation step by default: a publicly embedded
widget with write access is a prompt-injection target, and the security model was
specified before the features, not after — see
[D7](.ai/decisions/D07-write-action-security.md).

### v4 · Voice (post-v3, no date)

The same Deskbell brain on a phone line, built on existing open-source voice stacks
rather than infrastructure of our own, plus voice extensions to the eval harness. The
engine is transport-neutral precisely so this is a new transport rather than a rewrite —
see [D10](.ai/decisions/D10-transport-neutral-core.md).

## Current build order

1. ~~**Eval harness** (D8)~~ — built. Its first job now is measuring the three below.
2. ~~**Gaps view**~~ — built: the first analytics surface, and the one that tells an
   operator what to write next.
3. **Connectors** beyond the docs crawler.
4. ~~**Hybrid retrieval**~~ — built and measured; stays off until a corpus shows it earns
   its place.
5. **Retrieval endpoint and MCP server** — the chunks that match a question, each
   with its source page, over HTTP and over MCP, so an agent or UI you build can use
   the same knowledge the widget answers from.
6. **Several projects in one workspace** — create a project, switch between them,
   each with its own sources, widget key, appearance and policies. The schema has
   allowed it since the first commit; only the dashboard is single-project.

The headless client is deliberately last, not cut.

## Why the scope lines sit where they do

The decisions that shape this roadmap are recorded in [`.ai/decisions/`](.ai/decisions/):
D5 (overlay, never a helpdesk), D7 (write-action security before write actions),
D8 (evals ship with v1), D10 (transport-neutral core), D11 (self-host bar).
