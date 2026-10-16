# Thread sidebar

> Status: done · 2026-09-17

**Goal.** Conversation history is a list view behind a back chevron: one
screen at a time, fine in a corner popover. An embedded assistant, especially
one whose visitors are signed in and return over weeks, wants its threads
beside the conversation, with a way to start a new one, remove an old one and
see only the threads from where they are on the host. This spec adds that
layout as an option; the stacked list stays the default.

## Design

**`history-layout="sidebar"`.** A left rail beside the thread: a toggle that
collapses it to an icon column, a new-thread button, the list newest first
(up to 50), the active thread marked. Rows open on click; delete asks once,
inline in the row, and removes optimistically, putting the row back if the
server answers anything but "already gone". After every answer the list
refreshes so titles and order follow. The stacked list view is not shown in
this layout, and the header loses its back chevron. Below 480 px the open
rail overlays the thread instead of squeezing it.

**Scope.** With `scope-key` naming a key of the page's `context`, the rail
offers two tabs: threads from this key's value, or all of the visitor's.
"This" is the default; the label is copy (`scopeThis`, `scopeAll`). Without a
match the tabs do not appear.

**Resume.** `resume-thread` decides what a fresh open shows: `last` (the thread
this browser last had open, as today), `newest` (the visitor's most recent
thread, which follows a signed-in visitor across devices) or `none`.
`thread-idle-minutes` replaces the fixed 30-minute rollover; 0 never rolls
over, for surfaces where a thread is a ticket rather than a chat.

**Lazy creation stays.** A new thread exists on the server only once the
visitor asks; "new" clears the screen and nothing else.

**Identity.** The element's `getAuthToken` property (also
`deskbell("auth", fn)`) goes straight to the SDK client, so every request
carries the bearer when the host has one. A 401 on ask gets one retry with a
fresh token, then shows `copy.unauthorized` and emits `deskbell:unauthorized`.
`context` (a JSON object of `{ key: { id, name? } }`) travels on every ask and
the server keeps it from the first one.

## Non-goals

- Rename from the rail. The endpoint exists; a control for it is a later
  addition once titles are worth editing.
- Pinning, search, archive.

## Verify

- Sidebar renders in both states, rows open threads, new clears, delete asks
  then removes, rollback on a non-404 failure, scope tabs only with a match.
- `resume-thread=newest` opens the top of the list unless stale.
- Stack layout unchanged for every existing test.
- `deskbell.js` gzip delta at most 4 KB. Done: 22.0 to 24.3 KB, including the
  identity wiring.
