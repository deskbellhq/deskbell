# @deskbell/sdk

The typed client for the public API of a Deskbell server: streamed answers,
conversation history and feedback. The Deskbell widget runs on it, so a UI of
your own gets the same streaming, history and feedback behaviour.

No runtime dependencies. Works wherever `fetch` and `ReadableStream` exist:
browsers, Node 18 or later, edge runtimes. MIT licensed.

## Install

```bash
npm install @deskbell/sdk
```

## Create a client

```ts
import { DeskbellClient } from "@deskbell/sdk";

const client = new DeskbellClient({
  baseUrl: "https://your-deskbell.example.com",
  projectKey: "pk_live_...",
  sessionId: () => getOrCreateVisitorId(),
});
```

`baseUrl` is the origin of your Deskbell server; leave it out when the page is
served from the same origin. `sessionId` identifies the visitor, and possession
of a session is what authorises reading and rating its conversations, so keep it
per visitor and persist it. Pass a function to create it lazily on first use.

The project key is visible in page source and is not a secret. The server
answers requests from the origins on the project's allowlist.

## Ask a question

```ts
let answer = "";
for await (const event of client.ask({ message: "How do I install the widget?" })) {
  if (event.type === "token") answer += event.value;
  else if (event.type === "citations") render(event.citations);
  else if (event.type === "refusal") answer = "No grounded answer.";
  else if (event.type === "done") remember(event.conversationId, event.messageId);
}
```

Pass `conversationId` to continue a thread. The `done` event carries the ids
for both. Pass an `AbortSignal` as `client.ask(input, { signal })` to cancel.
The full event list, including `clarify` and `verification`, is in
[the API reference](https://deskbell.dev/docs/developer/api).

## History and feedback

```ts
const recent = await client.conversations.list();
const messages = await client.conversations.messages(recent[0].id);

await client.feedback({ messageId, feedback: "down", reason: "incorrect" });
await client.feedback({ messageId, feedback: null }); // clears the vote
```

## Errors

Any non-2xx response throws a `DeskbellError` with the HTTP `status` and, when
the server sent one, `retryAfter` in seconds. The client never retries.

```ts
import { DeskbellError } from "@deskbell/sdk";

try {
  for await (const event of client.ask({ message })) { /* ... */ }
} catch (error) {
  if (error instanceof DeskbellError && error.status === 429) {
    wait(error.retryAfter ?? 10);
  }
}
```

A 429 is a rate limit or the project's daily token budget, a 403 an origin not
on the allowlist, a 404 an unknown project key.

## What it does not do

No retries, no caching, no session management beyond holding the id you gave
it, no React bindings. It exposes only the endpoints the server answers today.

## Links

- [Documentation](https://deskbell.dev/docs/developer/sdk)
- [Source](https://github.com/deskbellhq/deskbell/tree/main/packages/sdk)
- [Changelog](https://github.com/deskbellhq/deskbell/blob/main/packages/sdk/CHANGELOG.md)
