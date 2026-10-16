# D5 — Deskbell is an overlay, never a helpdesk replacement

**Decision.** Deskbell layers on top of the support stack a team already runs. It is
embedded in a product or docs site, answers from that team's content, and (on the
roadmap) acts through MCP. It does not become the system of record for tickets,
inboxes, SLAs, agent scheduling, or CSAT reporting.

**Why.** Replacing a helpdesk is a migration, and a migration is a project with a budget
and a committee. Adding an overlay is a script tag. The two products also have almost no
shared surface: a helpdesk is a workflow and routing system, an answer engine is a
retrieval and grounding system. Trying to be both means being mediocre at the part that
is actually hard.

**What this rules out.** Ticket queues, agent seats and assignment, SLA timers,
macros, CSAT surveys, and the rest of the helpdesk surface. Where a team's existing
helpdesk holds knowledge, that is a **connector** (a source to answer from), not a
feature to reimplement — see `packages/connectors/`.

**Where it bites in code.** The Conversations view is a read-only record of what the
widget answered, not an inbox to work from. `packages/connectors/` treats helpdesk
platforms as sources to ingest, never as systems to replace.
