# 2026-08-21 — Widget conversation history: restore last thread + recent list

**Goal**: messenger-style continuity. Reopening the widget restores the visitor's
last opened conversation; a back chevron reveals their recent conversations; any row
reopens that thread; "Ask a new question" starts a fresh conversation. Today the chat
is in-memory only — a reload loses the thread even though the server has it and the
sessionId survives in localStorage.

## Decisions

- **Explicit `conversationId` supersedes find-or-create.** `AskRequest` gains optional
  `conversationId`: present → continue that thread (validated against
  org + project + sessionId, 404 otherwise); absent → the ask creates a NEW
  conversation. This retires the one-conversation-per-session triple from
  spec: mvp-end-to-end — a session now holds many conversations (no migration needed;
  the table never had a unique constraint on the triple).
- **Feedback route correctness fix ships with this**: it resolved THE conversation by
  the session triple, which breaks with multiple conversations per session. It now
  verifies the target message's own conversation belongs to the caller's session.
- **Read endpoints are POST** (`/api/v1/conversations` list,
  `/api/v1/conversations/messages` one thread) — body keeps the sessionId out of URLs
  and access logs; same CORS/origin skeleton and session-possession authorization as
  ask/feedback, same launch-blocking abuse-protection caveat (cheap reads, but they
  enumerate a session's data — rate limits land with spec: widget-abuse-protection).
- **List shape**: title = first user message, snippet = last message (~120 chars,
  truncated server-side), newest activity first, limit 20, zero-message conversations
  skipped. Same `array_agg` aggregate as the dashboard inbox.
- **Widget storage**: `deskbell-last-conv:{projectKey}` in localStorage (session key
  stays global). A 404 on restore (purged/foreign id) clears the key and falls back to
  the list. Restored messages carry ids + feedback, so thumbs show prior votes and
  stay votable.

## Out of scope

List pagination/search, cross-device history (session is per-browser), retention
purge job, unread badges.
