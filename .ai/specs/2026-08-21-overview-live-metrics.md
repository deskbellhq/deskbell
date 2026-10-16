# 2026-08-21 — Overview goes live: real metrics, embedded widget, Ask a question

**Goal**: kill the last demo data on `/`. Stat cards and the questions chart
read the database; the widget is embedded in the dashboard itself (dogfooding the real
embed path); the sidebar's dead "Ask a question" button opens it.

## Decisions

- **Cards show only what we measure** (no fabricated deltas/deflection): Conversations
  (total, +7d), Questions asked (user messages, +7d), Answer rate (grounded ÷ all
  assistant answers; refusals framed as gaps), Positive feedback (share of thumbs-up
  among votes). "—" when a rate has no denominator yet.
- **Chart = real daily series**, last 90 days, answered vs unanswered (refused)
  assistant messages, zero-filled server-side so the range toggles keep working; the
  client filters by slicing rows (no client-side clock — hydration-safe). Unanswered
  gets a distinct color (`--chart-4`) instead of primary-on-primary.
- **Widget in the dashboard layout** exactly like `/demo`: `/widget.js` script
  (lazyOnload — non-critical) + `<deskbell-widget>` with the project's public key.
  Same-origin, so no allowlist implications.
- **`deskbell:open` window event** — the widget listens and opens; "Ask a question"
  dispatches it. First brick of spec: widget-js-api (programmatic open/close/ask).

## Out of scope

Gaps + Top questions pages, per-range aggregates on the cards, deflection estimates
(needs resolution tracking), multi-project switcher.

## Addendum (2026-09-22): the chart and the rate say certain, not answered

The thread badge stopped saying "Answered" on 2026-09-14 (spec:
sources-line-and-thread-status) and the Overview kept two leftovers of the
old vocabulary on the same page as the new one. The chart's "unanswered"
meant a refusal while the badge two rows down used the word for a thread
with no reply, and the chart's "answered" counted weakly grounded answers
that the badge, the inbox filter and the gaps list all call uncertain.

Now the chart is **Answers**, certain against uncertain, with the badge's
definition: uncertain when the answer refused or was written from a best
match under the weak floor (the gaps page's weak class, same clarified and
null exclusions), certain otherwise. "Unanswered" is a thread state and
never a series. The **Answer rate** card uses the same numerator: certain ÷
all answers, rather than not-refused ÷ all, so a weak answer lowers the
rate the way it opens a gap. The three predicates are one SQL fragment in
the page so the recent rows, the series and the rate cannot drift apart.

## Addendum (2026-09-23): columns, a y-axis, and one hue plus grey

Real traffic is a few dozen answers over ninety days, so most days are
zero. The smoothed stacked area turned every busy day into a hump that
spilled onto its empty neighbours, and with no y-axis the spike carried no
number. The chart is now stacked **columns**, one per day: uncertain at the
baseline, certain on top, a two-pixel surface gap between the segments and
a rounded top on whichever is topmost (a custom bar shape; a stroke around
each segment would thin the columns instead). A quiet y-axis with a few
integer ticks gives a spike its count, and the tooltip label carries the
day's total beside the date.

Colour is one hue plus grey rather than ink plus accent: certain wears the
green of the bell mark and of the badge's check, uncertain is a light grey,
so the emphasis sits on the grounded answers and a gap reads as quiet space.
The dark steps are chosen for the dark surface rather than flipped. (Amber
on the uncertain series was tried first and dropped the same day: it was the
badge's colour, but as the only hue on the page it read as an alarm.) The
gradients are gone; columns are solid. The unused `--chart-1..5` tokens in
the shared theme, which differed between modes, are removed so the next
chart declares its colours in its config.

The stat cards lose the template's grey gradient, and the shared card
component loses its shadow: every panel in the dashboard is a bordered
surface on the page, never a floating one — the hairline language the docs
and the site already use.
