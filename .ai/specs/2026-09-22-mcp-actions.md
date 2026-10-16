# MCP actions

> Status: in progress · 2026-09-22

**Goal.** Deskbell answers from documents and cites; it takes no action in any
other system. This spec makes any remote MCP server a source of *actions*: the
server is attached to a project, its tools are discovered and shown to the
operator with the exact description the model will see, and each tool is
switched between **Off**, **Allowed** and **Needs confirmation**. During a
turn the answer engine may call Allowed tools, must pause on Needs-confirmation
tools until the visitor confirms a card in the widget, cites the results it
relied on, and records every attempt in an audit table. When a server asks for
it, the verified visitor reaches the server as a Deskbell-signed identity token
the server verifies against a key set this instance publishes. Postgres stays
the only infrastructure dependency (D11); nothing is added to docker-compose.

This is the implementation of D4 (actions exclusively through MCP) and D7 (the
four prerequisites for any side-effecting action). D16 supplied the first of
the four; the other three land here.

## Design

**Where the code lives.** The engine (`packages/core`) stays transport-neutral
(D10) and provider-free (root rule 8): it receives tools as data on
`AskInput.tools` and reports what happened through callbacks, exactly as it
reports usage and retrieval today. The model-config module
(`packages/core/src/models/`) is the only place that turns those tools into AI
SDK tools. The MCP client, the per-project configuration and the identity token
live in `apps/web/lib/actions/`. Wire types and validation live in
`packages/shared` (MIT; the widget reads the event types only).

**Tools reach the engine per request.** Per-project configuration, the
visitor's identity and the state of a paused approval all vary by request, so
tools are on `AskInput`, never on `EngineDeps` (which is built once from the
environment). An `EngineTool` carries a namespaced name (`<server slug>__<tool>`),
a title for the status line, the description the model sees, a JSON Schema for
the input, a policy (`allow` or `confirm` — `off` tools are never passed in),
whether the server declared it read-only, and an `execute` function. The engine
never learns that MCP exists.

**The model layer's stream widens.** `EngineDeps.generate` yielded text; it now
yields `string | GenerationPart` where a part is `text`, `tool-call`,
`tool-result`, `approval`, `step-end` or `paused`. Bare strings remain text, so
every existing caller and test is unchanged. The model layer maps
`streamText`'s `fullStream` onto these parts; `toolApproval` returns
`user-approval` for `confirm` tools; `stopWhen: stepCountIs(n)` bounds a turn
(`DESKBELL_ACTION_MAX_STEPS`, default 4). Approval requests are HMAC-signed by
the SDK (`experimental_toolApprovalSecret`, derived from `BETTER_AUTH_SECRET`)
so a forged approval never executes a tool.

**Holds across steps.** The refusal sentinel and the SOURCES tail are
character-level holds over the answer text. A tool call resets both: text that
preceded the call in the same step has already streamed (a model may narrate
"let me check"), a held tail that is not a sources line is flushed as prose,
and a refusal the model started before deciding to call a tool is discarded.
The final step's text is the answer; the sentinel therefore means what it
always meant, on the last step. When tools are present the engine no longer
refuses on an empty retrieval — the model is called with an empty context block
and the tools, and `no_context` is emitted only with no hits *and* no tools.

**The contract with tools.** The opening rule of the grounding prompt — answer only
from the context, refuse otherwise — outranks anything appended after it: with
unrelated documentation hits the model refused questions a tool could answer. With
tools present the engine therefore uses `SYSTEM_PROMPT_WITH_TOOLS`, whose opening
rule names tool results and says to call a tool before refusing; `SYSTEM_PROMPT`
itself is untouched.

**Tool results are data.** Each result is handed back to the model wrapped in
a `<tool_result>` block, capped in size, and the system prompt (extended only
when tools are present, so the eval baseline hash is unchanged otherwise) says
the block is material, never an instruction. The MCP server's `instructions`
string is never injected. Tool descriptions are capped and shown verbatim on
the settings page, so an operator sees exactly what the model is told.

**Citations.** Results are numbered `T1, T2…` in the order they arrived and
named on the SOURCES line beside block numbers (`SOURCES: 2, T1`). A cited
result becomes a `Citation` with `kind: "action"`, the tool's title, and a
snippet of the output; the widget labels it as an action.

**Confirmation.** A `confirm` tool call pauses the turn: the engine emits a
`confirm` event (the call id, the tool title, a server-rendered summary of the
input, the input, and when the request expires), the route stores the model
messages of the paused step on the audit row (`status: pending_approval`,
signed approval id, 10-minute expiry by default), and the stream ends with
`done`. The visitor's answer arrives as a new `/api/v1/ask` request carrying
`approval: { callId, approved }` and no message — the same endpoint, because
the continuation is an ask: it passes the same guard (origin, rate limits,
budget, concurrency, identity), spends model tokens, and streams the same
events. The route rebuilds the conversation from history plus the stored step
plus a `tool-approval-response`, and the SDK re-verifies the signature before
executing. A denial is fed to the model, which says what it did not do.
Retrieval is skipped on a resume; only tool results are cited there. Expired
requests are flipped hourly by the worker's maintenance job.

**Identity.** When a server is set to `identity: signed` and the guard verified
a visitor, every request to that server carries `X-Deskbell-Identity`: an
ES256 JWT with `iss` = this instance's public URL, `aud` = the server's slug,
`sub` = the visitor's subject at their identity provider, plus the provider's
issuer, email, name, project and conversation ids, and a five-minute expiry.
The public keys are served at `GET /api/v1/actions/jwks`. Keys are generated
on first use and stored in `signing_keys` — an instance-level table, a
documented D12 exception like `rate_limits`. Servers set to `signed` are not
offered to anonymous visitors at all: no identity, no scoped tools (D16). The
server's own credential is a separate header and never the visitor's token.

**Data model.** `action_servers`: one row per attached server (name, slug, URL,
transport `http` | `sse`, auth `none` | `bearer` | `header` with the secret,
identity mode, per-tool policies, the discovered tool list and server info,
status and last error). `action_calls`: the audit log — one row per attempted
call with input, truncated output, status (`running`, `succeeded`, `failed`,
`pending_approval`, `approved`, `denied`, `expired`), the approval id and
signature, the stored step for resumption, the end user, latency and error.
Both carry `org_id` (D12). The audit log is core: D7 makes it a prerequisite,
so it cannot live behind a licence.

**Secrets.** Server credentials follow the precedent of `identity` and
`notifications`: stored as written, masked on read, never served by a public
endpoint, an empty field on save keeps what is stored. Encryption at rest is an
open question below.

**Client lifetime.** A client is created per request with the cached
`initialize` result and tool list, so nothing touches the network until a tool
is actually called. The tool list is cached in memory for a few minutes
(`DESKBELL_ACTION_TOOLS_TTL_MS`) and persisted on the server row by the
settings page's refresh, so the dashboard renders without a live server. HTTP
redirects are refused (the SDK default) and the server URL passes the same
checks as a webhook URL: https, no credentials in the URL, no private address
literals except loopback.

**Widget.** Two new `AnswerEvent` members: `action` (a call started, finished,
failed or was denied) rendered as a status row under the answer, and `confirm`
rendered as a card with two buttons. Replayed messages carry `actions` so a
card survives a reload. New parts, copy keys and `deskbell:action` /
`deskbell:confirm` events follow the existing rules.

**Limits.** `DESKBELL_ACTION_TIMEOUT_MS` (30 s per call),
`DESKBELL_ACTION_MAX_STEPS` (4), `DESKBELL_ACTION_RESULT_MAX_CHARS` (8000),
`DESKBELL_ACTION_APPROVAL_TTL_MIN` (10), `DESKBELL_ACTION_TOOLS_TTL_MS`
(300000). Ten servers and one hundred tools per project.

**Settings page.** The list-and-page layout, the attach dialog and the
per-tool saves are specified in `2026-09-22-actions-settings-ui.md`.

## Non-goals

- Stdio MCP servers: they would run processes inside the web container.
- OAuth 2.1 dynamic client registration for remote servers (the client library
  supports it; bearer and header credentials cover self-hosted servers). A
  server that is a resource server of the project's own identity provider is
  covered since 2026-10-05 by the visitor's-token mode (spec:
  visitor-token-actions).
- Procedures (multi-step resolutions described once).
- Encryption of stored credentials at rest.
- Eval cases that declare fixture tools.

## Open questions

- Encryption at rest for `action_servers.auth_secret` and
  `signing_keys.private_jwk`: one key, one migration, its own spec.
- Key rotation: a CLI that retires the active key and publishes the retired
  one for a day.
- Whether tool descriptions should be editable by the operator (a server's
  wording is not always the one a model reads best).

## Verify

- `packages/core`: engine tests with a scripted `generate` (tool call then
  text; approval pauses; denial produces a sentence; `T<n>` citations; holds
  reset on a tool call; `no_context` only without tools); `sources.test.ts`
  for tool references; a model-layer test against an in-process MCP server.
- `apps/web`: settings merge tests (mask, keep, replace); identity token
  sign-and-verify through the JWKS route; Playwright: attach a fake server,
  see its tools, set a policy, ask a question that calls a read tool, confirm
  and deny a write tool, reload and see the card.
- `packages/widget-core`: DOM tests for the status row and the card; the parts
  and copy-key tests.
- Gates: typecheck, lint, tests, build (widget under 40 KB gzip),
  `docs:widget --check`, `docs:openapi --check`, `evals:check` unchanged.
