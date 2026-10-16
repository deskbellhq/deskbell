# Conversation context, titles, delete and rename

> Status: done · 2026-09-17

**Goal.** A conversation is a session id and a list of messages. The widget's
recent list shows the first question as the title and nothing about where the
question was asked. A page that embeds the widget inside a product knows
which account, site or product the visitor was looking at, and a visitor with
a long history wants to find, rename and remove threads. This spec gives a
conversation a title, an opaque context, and the two verbs.

## Design

**Context is opaque.** `AskRequest.context` is a small record, at most eight
identifier keys, each `{ id, name? }`. It is stored on the conversation at
creation and never interpreted: the server does not know what a "site" is.
Two things read it. The list endpoint filters on one key and id (`scope`), so
a widget can show "this site's threads" without the server learning the
vocabulary. The dashboard shows the pairs on the thread page.

**Titles are cheap by default.** At creation the title is the first question
on one line, trimmed to eighty characters. `DESKBELL_THREAD_TITLES=model`
enqueues one short chat-model call per new conversation, run by the worker,
budget-checked and recorded like every other model call it makes. The job
never overwrites a title the visitor chose: it compares the stored title
against the creation-time default and stands down on any difference. The
default costs nothing, which is why it is the default.

**Delete is soft.** `conversations.deleted_at` hides a thread from every
visitor-facing read through the one ownership clause (spec:
end-user-identity). The row and its messages stay: the gap clusters, the
feedback and the eval cases built on them are the operator's, not the
visitor's to erase. Retention is a separate concern with a separate job.

**Rename is a title write** on a row the caller owns. Both verbs are POST with
a JSON body like the other conversation endpoints, take the read guard, and
answer 404 for a thread the caller does not own, indistinguishable from one
that does not exist.

**Wire.** `WidgetConversation` gains `title` (stored, else the first question),
`context` and `updatedAt`; `ConversationListRequest` gains `scope` and `limit`
(at most fifty). Everything is optional; a widget built before this spec sees
what it saw.

## Non-goals

- Archiving as distinct from deleting.
- Searching conversations by text.
- Context on a message rather than on a conversation.

## Open questions

- Whether the titling job should also run for anonymous conversations. It does
  today; a deployment that wants titles only for signed-in visitors has no knob.

## Verify

- Shared schema tests: context key shape and cap, scope and limit bounds,
  rename title trimming and bounds.
- Worker test: titled, missing or renamed (no call), budget spent (no call),
  empty title (kept, usage still charged).
- SDK tests: context on ask, scope and limit on list, delete and rename
  request shapes.
- `titleFromQuestion`: whitespace collapsed, eighty-character cap.

## Widget side (added the same day)

`context` is a client-only option (a JSON object of `{ key: { id, name? } }`,
coerced with the same limits as the schema, never accepted from the server)
sent on every ask; `scope-key` names the key the thread list may be scoped
to. The sidebar (spec: widget-thread-sidebar) uses list, delete and the
titles.
