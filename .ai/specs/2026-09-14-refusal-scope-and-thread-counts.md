# Which refusals are gaps, and how a mixed thread reads

> Status: done · 2026-09-14

**Goal.** Two small follow-ups to the thread-status change. First, every
refused message is a gap candidate today, including the one the ask route
records when the engine throws: that row carries `refusal_reason = guardrail`
and reaches the gaps page as if the docs had failed, when a provider outage or
a bug did. The same holds for `off_topic`, which nothing emits yet but the
column allows. Second, a thread with one refusal among several answers now
reads Refused on the overview, which is the right rule but hides the shape of
the thread; a reviewer opening it expects the whole thing to have failed.
This keeps engine errors and off-topic refusals out of the gaps signal while
leaving them visible as refusals, and puts the refused count on the row when
a thread has more than one turn.

## Design

**A refusal the docs did not cause is not a gap.** The gap predicate in the
db package and the classifier in the web app both decide from the row; they
now agree that a refused row with reason `guardrail` or `off_topic` has no
gap kind. The predicate is the SQL half, so the gaps page, the export and the
cluster worker never see those rows; the classifier is the ask route's half,
so they are never enqueued for clustering. Rows with a null reason (written
before the column existed) keep classifying as a plain refusal, as before.
The overview and the Conversations inbox still count these as refusals: the
visitor saw a refusal, and the row is about what the visitor saw.

**The row says how many.** The overview's status cell shows "1 of 2 refused"
beside the Refused badge when the thread has more than one question and at
least one refusal. Single-turn threads and threads with no refusal show the
badge alone. The drawer shows the same line. The Conversations inbox keeps
its dot; the count belongs where there is room for it.

## Non-goals

A fourth status for mixed threads. Reviewer-set status tags on conversations.
Intent or sentiment classification of conversations. Emitting `off_topic`
from the engine.

## Open questions

None.

## Verify

- `classifyAnswer` tests: `guardrail` and `off_topic` refusals yield no gap
  kind and `isGap: false`; `no_context`, `no_grounding` and null are
  unchanged.
- A refused row with reason `guardrail` does not appear on `/gaps` and is
  not enqueued for clustering by the ask route.
- The overview row for a thread with one refusal in two questions shows
  "1 of 2 refused"; a single refused question shows the badge alone.
