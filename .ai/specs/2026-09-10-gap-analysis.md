# Gap analysis: a finding and a recommendation per cluster

> Status: done · 2026-09-10

**Goal.** A gap cluster tells an operator *what* visitors could not get
answered and how often. It does not say *why* the content fell short or
*what to write*. This asks the configured chat model to read a cluster —
its phrasings and the passages the engine found or cited — and produce a
short finding, a recommendation, and suggested marking criteria that feed
straight into the eval case. Analysis is a deliberate, budgeted spend: an
operator triggers it per cluster or for every open cluster without one,
and a self-hoster can opt into analysing clusters automatically once they
reach a number of occurrences. It runs in the worker, is counted against
the project's daily token budget, and is skipped when nothing about the
cluster has changed since the last run.

## Design

**Model access** stays in the model-config module. `createGapAnalyst`
follows the reranker: its own model setting (`DESKBELL_GAP_ANALYST_MODEL`,
defaulting to the chat model), its own timeout, the model built on first
use so a bad id fails one analysis rather than the worker's boot, a
structured call with a schema (`title`, `finding`, `recommendation`,
`suggestedFacts`, at most five), and token usage reported to the caller.
It is exposed as `createGapAnalystDeps`, separate from the engine's deps:
the answer path must never construct it.

**Inputs are data, never instructions.** Questions are typed by visitors
and passages come from ingested content; both go into the prompt between
delimiters with the system prompt stating they are material to analyse
and that instructions inside them are to be ignored. The output is
schema-bound, and the dashboard renders it as plain text. At most twelve
distinct phrasings and six passages of six hundred characters go in.

**Skip when unchanged.** The analysis is stored on the cluster with the
hash of what it was computed from — the phrasings, the evidence documents
and the model — so a second request with the same material clears the
pending mark and spends nothing. Counts are not part of the hash and not
part of the prompt; they change with every occurrence and are shown live
beside the analysis anyway.

**Budget.** The worker reads the project's daily budget and today's usage
before calling the model, refuses with a stored error when the budget is
spent, and records the call's usage afterwards. The helpers that did this
for the answer path move from the web app into `packages/db` so the worker
can call them; the web app re-exports them unchanged. Budget `0` means
unlimited, as it already does for answers.

**Two triggers, one job.** `gaps.analyze` takes one cluster id. The
dashboard enqueues it from an editor's click on a cluster or on "Analyze
all" (open clusters without a current analysis, newest first, at most
twenty per click). With `DESKBELL_GAPS_AUTO_ANALYZE_AT` set to a number
above zero, the assignment job enqueues it as well the moment a cluster
without an analysis reaches that many occurrences in the last thirty days
— once; a cluster that already has an analysis is left to the operator.
The default is off: automatic spend is something a self-hoster turns on.

**On the page.** Each row opens a detail panel with the phrasings, the
evidence, the analysis (title, finding, recommendation, suggested facts),
and Analyze or Re-analyze, with a pending state while the worker runs and
the stored error when it fails. Suggested facts flow into "Copy as eval
case" and the dataset export in place of the placeholder, marked in the
notes as suggested rather than verified. The CSV gains finding and
recommendation columns. The page refreshes itself while any analysis is
pending.

**Roles.** Analyze is an editor action, the same bar as re-indexing,
which also spends tokens; the spend control is the budget, which admins
set. Re-cluster stays admin.

## Non-goals

- Analysing across clusters ("the docs are weak on billing"). One
  cluster, one finding; the page is the overview.
- Rewriting the docs. A recommendation says what to write; it does not
  write it.
- A second model for analysis by default. It defaults to the chat model;
  the setting exists for operators who want a stronger or cheaper one.

## Open questions

- The compose worker receives only the OpenAI key today, so an analyst
  model on another provider works under `pnpm dev` and not under compose
  until the worker's environment grows. Pre-existing for the planner and
  reranker; noted here because the analyst is the first worker-side model
  call.
- Whether to re-analyse automatically when a cluster grows well past its
  last analysis. Not until someone asks; the operator can click.
- Feedback while the worker runs, and what happens to a request it never
  answers: spec `gap-analysis-feedback`.

## Verify

- With a small daily budget on the project, Analyze stores the budget
  error and spends nothing; with the budget reset, Analyze on a cluster
  stores a finding, today's usage row grows, and a second click without
  new material is a no-op.
- With `DESKBELL_GAPS_AUTO_ANALYZE_AT=1`, a new gap gets an analysis
  without a click.
- Suggested facts appear in the copied case and the exported dataset;
  the CSV carries the finding and recommendation.
- Tests: the analyst builds without a model and refuses empty input; the
  hash is order-independent and model-sensitive; the worker skips
  unchanged material, refuses on budget, records usage on success and
  stores the error on failure; assignment requests an analysis once at
  the auto threshold.
