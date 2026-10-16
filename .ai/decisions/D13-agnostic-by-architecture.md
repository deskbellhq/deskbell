# D13 — Agnostic by architecture, opinionated by default

**Decision.** Deskbell is permanently **LLM-agnostic** and **vector-store-agnostic** — as
an interface guarantee, not a configuration surface. At the same time the **defaults do
not move**: AI SDK v7 wiring, pgvector as the only driver a self-hoster needs, Postgres
as the only required infrastructure.

Agnosticism is a promise about *interfaces*. It is never a reason to add a dependency.

**Why.** These two halves are usually in tension and it is worth being explicit about how
they resolve.

The agnostic half exists because the alternative locks users in: your model, your
database, your servers is only true if the seams are real. Interfaces cost almost nothing
to define up front and cannot be retrofitted cheaply.

The opinionated half exists because "supports everything" is how self-hosted products
become unrunnable. Every pluggable backend is a matrix cell someone must test and
support. So: `VectorStore` is an interface with pluggable drivers, *and* pgvector is the
only driver in the box, *and* proposing a second one that self-hosters must run is
rejected by the self-host bar (D11), which wins.

**What this rules out.** Importing a provider SDK outside the model-config module.
Reaching around `VectorStore` to write pgvector-specific queries in application code.
Citing "but we're agnostic" as grounds for a new `docker-compose.yml` service — rule 7 of
root `AGENTS.md` wins that argument every time.

**Where it bites in code.** `packages/core/src/retrieval/vector-store.ts` (the interface) ·
`packages/core/src/models/` (the only provider-SDK import site) ·
`packages/core/src/engine.ts` consumes both through injection. Root `AGENTS.md` rule 8.
