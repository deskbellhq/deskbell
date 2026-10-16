# Configurable downvote reasons

> Status: done · 2026-09-17

**Goal.** A downvote offers three fixed reasons and a free-text field. Products
have their own vocabulary for what went wrong, and some want free text only for
"other". The wire accepted only the three ids. This spec makes the list a
project setting and widens the wire to any slug, keeping the three ids as the
default so nothing stored changes meaning.

## Design

**`feedbackReasons`.** A JSON array of `{ id, label, note? }`: `id` is a slug
(`^[a-z][a-z0-9_-]{0,39}$`), `label` is what the chip says, `note` is the
maximum length of a free-text field offered with that reason, absent for none.
Empty (the default) means the built-in three, each with the free-text field
they always had, so an existing deployment sees no change.

**With configured reasons** the free-text field appears only after a reason
with a `note` limit is picked, with a counter, and sending needs a picked
reason. The built-in path keeps accepting text without a reason.

**Server.** `reason` on the feedback endpoint becomes a slug rather than an
enum; the column already stores text (the enum lived in TypeScript only, so no
migration). The dashboard shows a configured id as itself when it has no label
of its own. Gap analytics count reasons by id and never assumed the set.

**Acknowledgement.** After a reason is sent, `feedbackThanks` shows beside the
thumbs for the rest of the session, and again on replay: the messages endpoint
now returns `feedbackReason`, so a reopened thread shows what was said. A
`feedback-thanks` part and a `feedback-note` part (the notice under the chips)
join the surface.

## Non-goals

- Editing a sent reason. The vote itself still toggles.
- A reason on upvotes.

## Verify

- Coercion: valid ids kept, bad ids and duplicates dropped, `note` capped.
- Wire: the feedback schema accepts `other` and rejects `Bad Id`; the built-in
  three still pass.
- Widget: built-in behaviour byte-identical; configured reasons gate the text
  field and the send button; thanks line appears after send and on replay.
