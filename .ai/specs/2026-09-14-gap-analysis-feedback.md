# Gap analysis feedback: what the page says while the worker works

> Status: done · 2026-09-14

**Goal.** Bulk analysis is a spend that takes a minute: one click sends up to
twenty clusters to the worker, which writes them one at a time. The page
gave no sign that the click landed, no progress, and no summary at the end;
a row being analysed looked the same as a row nobody had touched; a request
the worker never answered read as busy forever. This makes the bar above the
table a small state machine — offer, requesting, running with progress,
outcome, failures — puts the in-flight and failed states on the rows, and
treats an unanswered request as lost after a fixed time so it can be sent
again. It also makes the number on the button the number that is sent.

## Design

**The server counts, the client remembers one click.** Every number on the
bar comes from the rows in view: clusters that are open with no analysis and
no live request (what a click sends), requests inside the TTL (pending),
stored analyses, stored errors, and requests past the TTL (stale). The
client keeps one record the server cannot: what its own click asked for and
the counts at that moment. Progress is `total − pending` against
`requested + pendingAtStart`, clamped both ways because the automatic rule
can add requests mid-run; the outcome is the delta in analysed and failed
counts since the click. Completion is "nothing pending and the action has
returned", never "progress reached total", so a request the action skipped
cannot leave the bar stuck. The state machine is a pure module
(`apps/web/lib/gap-analysis-ui.ts`) with the copy in it, tested without React.

**Phases.** *Idle* offers the count, one sentence on what analysis does and
what it costs, and one primary button labelled with the capped count.
*Requesting* (the action has not returned) shows a spinner and a busy,
disabled button at once. *Running* (the server reports pending requests)
shows "Analyzing N clusters… M of N done" when the baseline is known and
"Analyzing N clusters…" when it is not, with no button: one thing at a time.
*Done* shows "N analyses ready", plus the failed count when there is one, for
eight seconds, then returns to idle. Idle with stored failures leads with
them — "N analyses failed — daily token budget reached" when every failure
is the budget, plain "N analyses failed" otherwise — and still offers the
button for the rest. Idle with stale requests adds one sentence naming the
TTL and pointing at the worker. The bar is hidden only when there is nothing
to offer, report or warn about.

**Rows and the panel.** A row with a live request shows a spinner and
"Analyzing…" (or "Re-analyzing…" under an existing analysis); a row with a
stored failure shows the short reason and "open Details to retry". The panel
renders a failure as an alert with the reason and, for a budget refusal, when
it resets and where to raise it; the retry is the existing button, which now
carries `aria-busy` and a spinner while busy. The panel does not poll on its
own: the page's poller runs whenever any cluster in view is pending, and an
open panel keeps its state across a refresh.

**The visible-ids contract.** `analyzeOpenClusters` takes the cluster ids the
page offered, capped, and re-checks each against the database — open, no
analysis, no request inside the TTL — before marking and enqueuing. The
button's number is therefore the number sent, whatever the period; a stale
page cannot spend twice; a lost request is sent again.

**The TTL.** A request older than fifteen minutes reads as lost. The worker
takes analysis jobs one at a time and the model call times out at thirty
seconds, so a full click of twenty drains in under ten minutes even when
every call times out; fifteen never cuts a live run short and does not leave
a dead worker spinning for half an hour. The constant lives in the UI module;
the query layer and the action import it from there.

**One poller.** The page mounts one `AutoRefresh` when anything is pending
or unassigned, instead of one per notice. The poller skips ticks while the
tab is hidden and refreshes once when it becomes visible.

**The budget error string** moves to `@deskbell/shared` so the dashboard can
tell a budget refusal from a model failure by equality rather than by a copy
of the worker's text.

**No confirmation, no toasts.** Analyze is an editor action on the same bar
as re-indexing, which has no confirmation; the cost sentence and the capped
count are on screen before the click, and the daily budget is the spend
control. The states that matter live on screen for a minute in a live
region, so a toast would repeat them; the one ephemeral event, a rejected
request, is shown inline under the status text.

## Non-goals

- Progress columns in the database, or a websocket. Polling every five
  seconds is enough for a run measured in seconds per cluster.
- Analysing across clusters. Unchanged from `gap-analysis`.
- Batching the request's round-trips. Twenty sequential updates and enqueues
  take well under a second; the feedback problem was visual, not latency.

## Open questions

- Whether the eight-second outcome flash should stay until dismissed when
  there were failures. Not until someone misses one.
- Whether the TTL should also drive the worker (drop a job whose request was
  cleared by a later one). Today a late answer to a re-sent request simply
  overwrites; harmless, and the hash check makes the second call a no-op
  when the material is unchanged.

## Verify

- Unit: the phase function, progress and outcome clamping, every phase's copy
  and singular forms, hidden only when there is nothing to say; the pending
  predicate at the TTL edge; failure classification; the summary's counts and
  the order of the ids it offers.
- Browser: the bar's count on the default view; a seeded pending cluster
  shows on the row, in the bar and as a busy button in the panel; a seeded
  budget failure shows the reason on the row, in the bar and as an alert in
  the panel with the button enabled; clicking the bar's button confirms at
  once and shows "0 of 3 done" with the rows marked. Existing selectors,
  totals and the phone-width overflow check unchanged.
- Manual, worker running: click → spinner at once → progress climbs every
  five seconds → "N analyses ready" → the bar returns to offering the rest.
- Manual, budget set to 1: failures land with the budget reason and the
  midnight-UTC advice.
- Manual, worker stopped: the running state lasts fifteen minutes, then the
  rows return to analyzable, the bar warns about the worker, and the panel's
  button re-enables.
