# Sources line without its prefix, and what a thread's status means

> Status: done · 2026-09-14

**Goal.** Two defects that show up on the overview page, both found in stored
answers. First, the model ends answers with the block numbers it used but drops
the `SOURCES:` prefix, so the strict parser treats the line as prose: the visitor
sees a stray `1,8` under the answer, `sources_named` never becomes true, and
citations fall back to everything retrieved. Every stored answer that carries a
numbers-only final line carries it without the prefix; none carries the prefix.
Second, a conversation's row on the overview pairs the first question with the
status of the last answer, so a refused question reads as "Answered" once any
later question in the same thread is answered. The widget makes this common by
resuming the last thread indefinitely, so unrelated questions days apart share a
row. This fixes the prompt so the prefix is unambiguous, teaches the parser the
prefix-less form under guards, makes the row's status mean the same thing the
Conversations page already means, and starts a fresh thread after a long idle.

## Design

**The prompt names the prefix as the line.** The instruction read "the line
must contain nothing but numbers and commas", and a model that follows it
literally omits the prefix. The instruction now says the final line is exactly
`SOURCES:` followed by the numbers, with the example kept.

**The parser accepts a bare numbers line, guarded.** `splitSourcesTail` also
holds a final line made only of digits, commas and blanks, and releases it the
moment a different character arrives, exactly as it does for a partial
`SOURCES:`. `parseSourcesTail` returns the parsed form (`prefixed` or `bare`).
The engine trusts a bare line only when both hold: some prose precedes it (the
held tail begins with a newline, so an answer that is just `5` is never
swallowed), and every number is within the retrieved range. Otherwise the tail
is prose and reaches the visitor unchanged. The guard is what makes the
tolerance safe: "The limit is\n5000" fails the range and stays an answer.
The remaining exposure is an answer whose last line is a lone in-range number
after prose, which the concise prompt makes rare and the fixed prompt makes
rarer, since a model that writes the prefix never reaches the bare path.

**Named means named.** `onSources` keeps its shape; a bare line that passes the
guard reports `named: true` like a prefixed one. The dashboard's answer signal
does not need to distinguish them.

**The overview row means what the Conversations page means.** The sidebar on
the Conversations page already marks a thread refused when any answer in it was
refused. The overview row adopts the same rule: refused if any assistant message
refused, answered if any assistant message exists, unanswered otherwise. Its
title stays the first question, as everywhere else. The preview drawer shows the
answer to that first question rather than the latest answer, so title, status
and preview describe the same turn, and states how many questions the thread
holds when there is more than one, with the existing link to the full transcript.

**A thread goes stale after thirty minutes.** The widget remembers the last
opened thread per project and resumes it on open. It now also remembers when the
thread last moved: the newest message's timestamp on restore, the clock on a
completed ask. Opening the widget after thirty minutes of silence, or sending a
question after that long with the panel still open, starts a new conversation
instead of appending. The old thread stays in the recent list and can be
reopened by hand, which is deliberate: the visitor chose that thread, so the
timer does not apply to an explicit reopen until the next long silence. The
threshold is a constant in the widget; making it a customization attribute
waits for someone to need a different value.

## Non-goals

Rewriting the six stored answers that carry a leaked tail; they are historical
rows and the text is harmless. Inline per-claim markers. A visible "new
conversation started" notice in the widget. Changing the Conversations page.

## Open questions

None.

## Verify

- `pnpm test` in `packages/core`: bare tail parsed when guarded, rejected when
  a number is out of range or no prose precedes it, prefixed form unchanged,
  false-positive cases in `sources.test.ts` still pass.
- Ask the widget a question against a real model and confirm no trailing
  numbers, one or two citation pills, and `sources_named = true` on the row.
- Seed a thread with a refused first answer and an answered second one; the
  overview row reads Refused, the drawer shows the refused turn and "2
  questions".
- In the widget, set the stored thread's last activity into the past and
  reopen: the thread view is empty and the next ask creates a new conversation.

## Addendum (2026-09-14, later): certain and uncertain, not answered

"Answered" was a tautology — every thread with an assistant reply is
answered, so the badge said nothing the row did not. The headline is now
confidence. A thread is **Certain** when every answer was grounded above the
weak floor and none refused, **Uncertain** when any answer refused or was
weakly grounded, **Unanswered** until an assistant message exists. The weak
class is the one the gaps page already flags (`isWeakAnswer`), so the
Overview row, the Conversations inbox, the thread page and the gaps page
agree on what is uncertain; before this, a weakly grounded answer was a gap
on one page and "Answered" on the other. The thread rule is unchanged in
shape — one uncertain answer marks the thread — and the detail line beside
the badge says why: "refused", "weak grounding", or on a longer thread
"1 of 4 refused · 1 weak". The derivation is one pure module,
`lib/thread-status.ts`, under unit test. "Certain" is a claim about
grounding, not correctness: a confidently wrong answer reads Certain until a
visitor marks it down, which is what the feedback column is for.

## Addendum (2026-09-23): one pair of colours for the two states

The badge said certain with a filled green check and uncertain with an
outlined amber slash, while the Overview chart had moved to the bell's
green against grey, so the same word wore two colours on one page. The two
answer states are now theme tokens, `--certain` and `--uncertain`, read by
the chart, the thread badge, the thread page's refused marker, the inbox
dot and the done-checks on the getting-started page. The two answered
badges are built the same way — a filled disc with a card-coloured glyph —
and only unanswered stays hollow, because nothing has happened yet. Amber
is no longer a state colour; it is left for warnings the operator must act
on (install pending, a missing model key, the gaps banner).
