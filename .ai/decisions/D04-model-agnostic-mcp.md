# D4 — Model-agnostic from day one; actions exclusively via MCP

**Decision.** Deskbell works with any LLM provider or local model, and every write-action
it can take reaches the outside world through the **Model Context Protocol**. Deskbell
does not ship bespoke per-vendor action integrations.

**Why.** Two separate reasons.

*Model-agnostic:* self-hosters have already chosen a provider, or are running Ollama on
their own hardware precisely so that no third party sees their users' questions. A
product that hard-codes one vendor is unusable for a large share of the people it is
built for. The cost of the abstraction is one interface; the cost of retrofitting it is
a rewrite.

*MCP for actions:* MCP is a governed, cross-vendor standard under the Linux Foundation.
Building on it means the set of things Deskbell can *do* grows with the ecosystem rather
than with our integration backlog, and every action shares one security model (see D7)
instead of each integration inventing its own.

**What this rules out.**
- Importing a provider SDK anywhere outside the model-config module.
- Direct, non-MCP integrations for write actions, however convenient a one-off would be.

**Where it bites in code.** `packages/core/src/models/` is the only place allowed to
import provider SDKs — see `packages/core/AGENTS.md`. Model access elsewhere goes through
the engine's injected model interface (`packages/core/src/engine.ts`). AI SDK v7 sits
underneath. Actions enter the engine as data (`AskInput.tools`) and the only thing that
produces them is the MCP client in `apps/web/lib/actions/` (spec: mcp-actions). Related:
D13, which makes this a permanent interface guarantee rather than a v1 convenience.
