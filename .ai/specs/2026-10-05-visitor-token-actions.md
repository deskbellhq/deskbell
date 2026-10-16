# 2026-10-05 — Actions with the visitor's own token

> Amends: 2026-09-22-mcp-actions (Identity) · Status: in progress

**Goal**: an MCP server that is an OAuth resource server of the project's own
identity provider can be attached. Such a server accepts no instance
credential: every request must carry an access token issued for that server
to the person asking. Today a server learns who the visitor is only through
`X-Deskbell-Identity`, a token this instance signs, which a server built on
the MCP authorization spec does not read. This adds the mode where the
visitor's provider token itself reaches the server, exchanged for one
addressed to the server when the provider offers that.

## Decisions

- **A third identity mode, `visitor`**, beside `none` and `signed`. The
  server receives `Authorization: Bearer <token>` where the token derives
  from the one the widget sent on this request and the guard verified (D16).
  Nothing else about the request changes: the server's own credential, when
  it has one, is a header credential, never a second bearer, and the
  policies and confirmation flow are untouched.
- **Exchange when configured, forward when not.** With an exchange client
  configured on the server row, Deskbell performs an RFC 8693 token exchange
  at the provider: `subject_token` is the visitor's token, `audience` and
  `scope` are the row's, the client authenticates with id and secret. The
  token endpoint is read from `<issuer>/.well-known/openid-configuration` of
  the project's identity issuer, cached per process. Without an exchange
  client the visitor's token is sent unchanged — correct only when the server
  accepts the same audience as the product the widget is embedded in, which
  is the operator's call and the settings page says so.
- **The visitor's token is never persisted.** The guard verifies it and
  drops it; the ask route reads it from the request header again, only when
  a verified visitor is present, and hands it to the tool setup for the life
  of that request. Exchanged tokens are not cached in this version: the
  exchange runs when the first tool of a server is called in a request, so a
  turn that calls no tool costs nothing.
- **Anonymous visitors get none of the server's tools**, as with `signed`.
- **Discovery needs a token too.** The instance has no visitor at save time,
  so the save-time discovery of a `visitor` server fails with the server's
  401 and the row reads unreachable. *Refresh tools* on the server page
  accepts an optional one-time token: used for `initialize` and
  `tools/list`, never stored, never logged. The attach dialog says so when
  the mode is chosen.
- **Validation.** `identity: visitor` with `authKind: bearer` is refused
  (two bearers, one header). An exchange is configured by its client id;
  the secret follows the credential precedent (masked on read, empty keeps
  the stored value) and is required when a client id is set. Audience and
  scope are optional strings. The discovered token endpoint passes the
  webhook URL checks before it is called.

## Data model

`action_servers` gains `exchange_client_id`, `exchange_client_secret`,
`exchange_audience`, `exchange_scope` (text, nullable). `identity` admits
`visitor`. Migration `0022_visitor_token_actions`.

## Where it lives

- `packages/shared/src/actions.ts`: the mode, the exchange fields and limits.
- `apps/web/lib/actions/token-exchange.ts`: discovery of the token endpoint
  and the exchange request, pure enough to test against a fetch stub.
- `apps/web/lib/actions/mcp.ts`: `connectActionServer` takes a
  `visitorToken` and sends it as the bearer; discovery takes a one-time one.
- `apps/web/lib/actions/tools-for-request.ts`: the per-request token, the
  exchange, the anonymous skip.
- `apps/web/app/api/v1/ask/route.ts`: reads the header for a verified visitor.
- `apps/web/app/(dashboard)/actions/*`: the mode in the connection fields,
  the exchange fields, the discovery token on refresh.
- `apps/docs/content/docs/actions/visitor-identity.mdx`: the second mode.

## Open

- A per-visitor cache of exchanged tokens keyed on subject and server,
  honouring `expires_in`.
- Encryption at rest for the exchange secret, with the other credentials.
- A `client_credentials` grant for discovery where the exchange client has a
  service account, so refresh needs no pasted token.
