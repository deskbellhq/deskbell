# Events, lifecycle and host integration

> Status: done · 2026-09-17

**Goal.** The widget's JavaScript surface was open, close, toggle, ask and
config, with six events on `window`. An application that mounts the widget on
some routes, opens it from a search box with the query prefilled, follows its
own theme toggle, or forwards events to analytics needed pieces that were not
there. This spec adds them without changing what exists.

## Design

**Events dispatch on the element**, bubbling and composed, so they reach
`window` listeners exactly as before (bubbling ends at `window`) and are also
available on the element itself, which a wrapper element needs. Payloads grow:
`deskbell:answer` carries `answer` and `citations`; new events `deskbell:ready`
(once per element, after the first paint), `deskbell:error` (`question`,
`status`), `deskbell:conversation` (`id`, `action`: created, opened, reset) and
`deskbell:citation` (`href`, `documentId`, `title`). `deskbell("on", name, fn)`
and `("off", ...)` are sugar over `window.addEventListener` and work before the
bundle loads because the stub queues all three arguments.

**`open` takes options.** `deskbell("open", { query, submit })` opens with the
composer prefilled, or asks straight away with `submit: true`. The pattern a
search box needs: hand the typed query to the assistant.

**Lifecycle for applications.** `data-render-on-load="false"` on the script
tag stops the loader from mounting. `deskbell("mount", overrides?)` mounts the
element with the tag's `data-*` attributes plus per-call overrides, and
`deskbell("unmount")` removes every widget on the page. This is a loader
concern, not a widget option: the element has no opinion on when it exists, so
`render-on-load` does not join the descriptor.

**Colour scheme from the host.** `color-scheme-selector` names the element a
site keeps its theme on (usually `html`). A `dark` or `light` value in its
`class`, `data-theme`, `data-color-mode` or `data-bs-theme` overrides the
configured scheme, and a `MutationObserver` follows the toggle. Nothing
recognisable means the configured scheme applies. The reading is a pure
function under test.

## Non-goals

- A promise-returning API. Commands are fire-and-forget by design; the events
  are the return channel.
- Event replay for listeners attached after the fact.

## Verify

- Scheme reading under test; `styles.test` covers the parts.
- Manual: `deskbell("open", { query: "install", submit: true })` asks; a theme
  toggle flips the widget; `mount`/`unmount` from the console with
  `data-render-on-load="false"`.
