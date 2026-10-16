# 2026-09-23 — A column of the Overview chart opens that day's conversations

**Goal**: the Answers chart on the Overview is a door, not a picture. Clicking
a day's column opens the Conversations inbox narrowed to the threads that had
a message that day, so a spike can be read thread by thread.

## Decisions

- **The day is URL state**, `?day=YYYY-MM-DD`, beside the existing `?filter=`
  (spec: conversations-inbox-polish). Both apply at once; the defaults are
  omitted from links. A day that is not a real calendar date in that shape is
  ignored rather than an error.
- **The bucket is the chart's bucket**: a message's UTC calendar day. The
  chart, the row's list of days and the index page's `having` all compute it
  with the same expression, so the column's count and the list's rows agree.
- **A thread is on a day when any of its messages is** — a follow-up asked
  today puts a week-old thread on today, which is what the chart counted.
- **The rows carry their days**: the layout still lists once and unfiltered,
  and the client shell narrows by `days` the way it narrows by the two
  booleans; the index page asks the SQL side with the same view to pick the
  thread to open.
- **The inbox shows the day as a chip** with an × that keeps the filter and
  drops the day. Segment counts are within the day, so they add up to what
  is listed; an empty day says which day it was.
- **A column is clickable and says so**: pointer cursor on the columns and
  "click to open" in the tooltip label whenever the day has answers. A day
  with no answers has no column and nothing to open.

## Limits

- Keyboard users reach the day through the Conversations page and its period
  control; the columns are not focusable.

## Superseded the same day

`?day=` became a one-day custom range, `?from=D&to=D`, when the inbox got a
period control of its own and the list moved behind the view (spec:
conversations-date-range). The cap limit above is gone with it.
