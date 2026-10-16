# One transport: the SDK client the widget also runs on

> Status: done · 2026-09-17

**Goal.** `@deskbell/sdk` wraps one of six public endpoints, and the widget does
not use it: `panel.tsx` carries its own SSE reader, its own JSON helper and three
raw `fetch` calls, so the two disagree the moment either changes. Every
capability the widget gains from here (bearer tokens, thread management, request
cancellation, typed errors) would have to be written twice. This spec makes the
SDK the only transport, complete over the public API, and makes the widget its
first consumer, so that anyone extending Deskbell programmatically builds on
exactly what the widget runs.

## Design

**Surface.** `new DeskbellClient({ baseUrl, projectKey, sessionId, fetch })`,
where `baseUrl` is the server origin (empty for same-origin) and `sessionId` is
either a string or a function called lazily on first use, because the widget
mints its session on first open, not on construction. Methods map one to one
onto the public endpoints: `config()`, `ask()`, `ping()`, `conversations.list()`,
`conversations.messages()`, `feedback()`. `ask` is an async iterable of
`AnswerEvent` and takes an `AbortSignal`; closing the panel aborts the stream as
before. Endpoints that do not exist yet get no method; the SDK never promises
more than the server answers.

**Errors.** A non-2xx response throws `DeskbellError` carrying the HTTP status
and, when present, the `retry-after` header in seconds. The widget maps status
429 to its rate-limit copy and everything else to its generic error, which is
the behaviour it had, expressed through one type instead of string matching.

**Dependencies.** None at runtime. Types come from `@deskbell/shared` as
type-only imports, so zod never enters a consumer's bundle. The SSE parser is the
one the widget had (it tolerates chunk boundaries inside a frame, ignores
comment lines and skips a malformed frame instead of failing the stream) and is
exported for anyone speaking to the ask endpoint with their own client.

**The widget rule.** `packages/widget-core/AGENTS.md` says zero dependencies
beyond preact. The SDK is workspace-internal, dependency-free, and inlined by
esbuild exactly as `@deskbell/shared/widget-config` already is; the rule's
intent (no third-party code, no bundle growth) holds, and the measured cost is
recorded in the verify section. The element's config fetch moves to the client
too, so no `fetch` call remains in the widget outside the SDK.

**Free-function fetch** (found the same day, in a browser). The client stored
the global `fetch` and invoked it as a method, so Chrome threw "Illegal
invocation" on every request while Node and the fake-fetch tests were happy.
The stored function is now always called as a free function, and a strict
fake in the tests refuses any other receiver.

## Non-goals

- React hooks or any framework binding. The client is plain TypeScript; the
  widget and the React wrapper are the bindings.
- Retries. A failed ask is surfaced, not repeated; the model call behind it
  costs money and the caller decides.

## Open questions

- Whether `config()` should return a coerced `WidgetConfig`. It returns the raw
  object today because coercion lives in `@deskbell/shared/widget-config` and the
  SDK should not depend on the widget's descriptor to talk to the server.

## Verify

- SDK unit tests with a fake `fetch`: request shapes for every method, SSE
  framing across chunk boundaries, comment lines ignored, 429 mapped to
  `DeskbellError` with `retryAfter`, abort propagates to `fetch`.
- Widget behaviour unchanged: a rate-limited ask shows the limited copy, closing
  the panel mid-answer aborts, a purged conversation id is forgotten.
- `deskbell.js` gzip delta under half a kilobyte. Done: 16.5 to 16.6 KB.
