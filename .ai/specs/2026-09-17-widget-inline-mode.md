# Inline mode, header actions, disclaimer

> Status: done · 2026-09-17

**Goal.** The widget is a launcher in a corner and a popover above it. Some
pages want the same conversation as part of the page: a help tab inside an
application, a full-page assistant, a support portal's main column. Today that
takes CSS against `::part(panel)` and a launcher hidden with `launcher="none"`,
and the panel still thinks it can be closed. This spec adds a mode the widget
understands, a slot for actions in the header, and a disclaimer line, the
three things an embedded conversation needs that a corner popover does not.

## Design

**`mode="inline"`.** No launcher, always open, the panel is `position: static`
at 100% of its host. The host page owns size and placement: the element gets
`display: block` through a reflected `data-mode` attribute (config may arrive
from the server, so the mode is written where host CSS can see it) and the page
gives it a height. Escape and `close()` do nothing; `toggle()` keeps it open.
The composer is not focused on load, because an inline widget is part of a
page that has its own focus order. The welcome cards lay out in two columns.

**Header only when slotted.** A popover needs a header for its close button
and title; an inline widget usually sits under the page's own heading. The
element passes the names of the slots the host filled to the panel, and in
inline mode the header renders only when a `header` slot is present. A
`MutationObserver` on the light DOM repaints when slotted children change.

**`header-actions` slot.** A place beside the close button for a host's own
controls, such as a button that opens the conversation on a full page. The
widget defines no such action; it defines the slot.

**`disclaimer` option.** Inline Markdown rendered above the footer, so an
operator can write "Answers are AI-generated. [Learn more](url)". Same renderer
as answers, same link rules. The `feedbackNote` copy key does the same under
the downvote reasons, for a data-handling notice.

**Copy.** `welcomeTitle` (a heading above the empty-state text, hidden when
empty), `feedbackNote`, `feedbackThanks` (spec: widget-feedback-reasons),
`thinking` (the pending indicator's accessible name). The indicator gains a
`typing` part so a host can give it visible text.

**Inline after the first paint** (added later the same day). The element paints
synchronously on connect when it has no project key to fetch config for, and
a wrapper element that sets attributes after connecting, or a `configure()`
call, can turn the widget inline afterwards. `open` was initial state only,
so such a widget stayed closed. An effect now opens the panel whenever the
mode becomes inline.

## Non-goals

- Multiple inline widgets sharing one conversation. Each element is its own.
- A full-page layout preset. Inline plus host CSS is the layout.

## Open questions

- Whether inline mode should suppress the `deskbell:opened` event on mount. It
  fires once, which is accurate.

## Verify

- `mode="inline"`: no dock rendered, panel static, Escape ignored, header
  absent without a slot and present with one, two-column welcome cards.
- Header actions render beside the close button in floating mode.
- Disclaimer renders Markdown with a working link; empty renders nothing.
- Floating mode unchanged for every existing test. Done; the three specs
  together cost 18.8 to 20.4 KB gzip on `deskbell.js`.
