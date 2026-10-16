# Read-only conversation preview for support staff

> Status: done · 2026-09-17

**Goal.** A support person helping a signed-in visitor wants to see the
conversation that visitor had with the widget, inside the tool they already
work in, without a dashboard account. The dashboard's thread page exists but
lives behind dashboard authentication and a different product surface. This
spec lets a staff member's own token open any conversation of the project,
read-only, in the widget.

## Design

**Authorisation is a claim, not a role table.** The project's identity settings
already hold an optional staff claim (a path into the token and a value). The
new endpoint `POST /api/v1/conversations/preview` accepts a verified end-user
token whose claims match it, and nobody else: no claim configured means the
endpoint refuses everyone, a missing or non-matching token gets 403, and
ownership does not apply. The same verifier, the same read guard, no minted
tokens and no cookies; dashboard roles (D12) are untouched.

**What it returns.** The conversation (id, title, context, creation time), its
owner's name and email when it has one, and the messages exactly as the
replay endpoint shapes them, so the widget renders them with the same code.

**The widget.** `readonly` implies the inline layout (no launcher, always
open, header only when slotted) and removes the composer, the sidebar and the
empty state; the thumbs stay visible but disabled, so what the visitor voted is
readable. `conversation-id` names the thread. With `readonly` it loads through
the preview endpoint and emits `deskbell:preview` with the title and owner;
without it, it opens that thread through the owned path, ignoring the idle
rollover, which lets a page deep-link to a visitor's own thread. Both options
are client-only: they describe the page, not the project.

**Failures.** 401 and 403 show the `previewForbidden` copy; anything else the
generic error. Nothing retries.

## Non-goals

- Editing, rating or continuing a conversation from the preview.
- Listing another visitor's conversations. One thread per link is the feature.

## Verify

- SDK: the preview request shape.
- Route: no staff claim configured or no matching claim gives 403 whoever asks;
  a matching claim reads a thread the caller does not own; a deleted thread is
  404 (covered by typecheck and the route's guard tests; a browser check with a
  signed token is in the widget browser suite).
- Widget: readonly renders the transcript with disabled thumbs and no composer.
