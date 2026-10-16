# Answer signal: what the engine knew when it answered

> Status: done · 2026-09-10

**Goal.** Persist, per assistant message, the evidence the engine had when it
answered: how many chunks retrieval returned and how well the best of them
scored, why a refusal happened, whether the model named the sources it used
or the citations were the whole retrieved set, how long the answer took and
which model wrote it. Today all of that is computed and thrown away one line
before the row is written, so the docs-gaps page can only see the two signals
a visitor supplies (a refusal or a thumbs-down). An answer written from weak
evidence, or one that cites everything because the model named nothing, is
invisible until someone complains. With the signal stored, the page can flag
those answers as gaps too, and the eval harness gets the same numbers so the
threshold that decides "weak" is chosen by measurement rather than by feel.

## Design

**Columns on `messages`** (migration 0008), all nullable so historical rows
stay valid and classify from what they already carry:

| Column | Meaning |
|---|---|
| `retrieval_hits` | Chunks retrieval returned after the per-document cap and limit |
| `retrieval_top_score` | Highest cosine among those chunks; null when none carried a score (lexical-only hits) |
| `retrieval_mean_score` | Mean over the scored chunks, same null rule |
| `refusal_reason` | `no_context`, `no_grounding`, `off_topic` or `guardrail`; null on an answer |
| `sources_named` | Whether the model named the blocks it used. False means the citations are the whole retrieved set |
| `latency_ms` | First event to last, as the route saw it |
| `model` | The chat model id configured when the answer was written |

Scores are stored as `real`: cosine similarity does not need double precision
and the column is read in aggregate.

**Two refusals, two reasons.** The engine refuses on two independent paths:
retrieval returned nothing, or the model read the context and declined. Both
used to report `no_grounding`, which made "the docs have nothing on this" and
"the docs have something and the model would not use it" the same row. The
first path now reports `no_context`. Under the shipped retrieval defaults the
score floor is off, so a non-empty corpus always returns something and
`no_context` appears only on an empty corpus or under an operator-set floor;
the hit count and top score on a `no_grounding` row carry the rest of the
story (eight hits with a top score of 0.07 is "nothing relevant" in all but
name). The wire union in `@deskbell/shared` gains the value; the widget passes the reason through to its `deskbell:refusal`
event untouched and renders the same copy for every reason, so nothing
downstream changes shape.

**Sources named** is only knowable inside the engine: when the model names no
block, the engine cites the whole retrieved set on purpose (an answer under no
sources looks broken), and the `citations` event is identical either way. A
new optional `onSources` callback on `AskInput` reports it, for the same
reason `onUsage` and `onRetrieval` are callbacks rather than events: it is an
engine internal the visitor never sees.

**Classification** lives in `apps/web/lib/gaps-signal.ts`, pure and tested.
A row is a gap when it is refused, marked down, or a *weak answer*: answered,
with the top retrieval score below `DESKBELL_GAPS_WEAK_SCORE`. Precedence for
the badge is refused, then marked down, then weak. A null never flags: rows
written before this change are classified from `refused` and `feedback`
alone, and a refusal with a null reason stays an unsplit "refused".

**"Named no source" is counted, not flagged.** The first read of the column
on the development database showed 33 of 44 answers citing all eight
retrieved passages, which is the engine's fallback for a model that named
none. Making that a gap would have flagged three answers in four. So an
answer with `sources_named = false` is tallied per group as *unsourced* and
shown, and the rate is the finding: the answering model rarely writes the
sources line it is asked for, which is a generation defect (spec:
grounded-generation) rather than a content gap. When that is fixed the
column is how anyone will know.

**The threshold is measured, not guessed.** The eval harness now records the
top and mean retrieval score per case beside the document ids it already kept
(never in the baseline, so no gate moves). `scripts/measure-weak-score.ts`
joins a retrieval-only report with a judged report of the same set and
tabulates, per candidate threshold, how many wrong or refused answers a floor
would have caught against how many correct answers it would have flagged. The
default is the value that flags few correct answers while catching the most
wrong ones on the private tuning set; the table is in Measurements below. The
value is a property of the embedding model: a different model moves the whole
scale, and the knob exists so an operator can re-measure.

**Ask route.** `onRetrieval` keeps a summary (hits, top, mean) beside the
citation-shaped copy it already keeps; the refusal event's reason is captured;
the catch path records `guardrail`; latency is measured around the event loop;
the insert writes the seven columns.

**Indexes.** `messages (org_id, created_at)` for the period-bounded reads the
gaps page is about to make; a partial index over gap rows
(`role = 'assistant' and (refused or feedback = 'down' or sources_named = false)`)
so those reads do not scan every answer; `conversations (project_id,
created_at)` because `messages` carries no project id and every dashboard read
joins through conversations. The score floor cannot be in a partial index (it
is an environment value), so weak-by-score rows are found by scanning the
period's rows, which is bounded by the first index.

## Non-goals

- A groundedness check on the drafted answer. That is generation work with
  its own spec; this records evidence, it does not judge prose.
- Persisting the full retrieved set with scores per chunk. The aggregate is
  what the page and the threshold need; the harness has the per-chunk view.
- Changing what the widget shows on a refusal. Same copy for every reason.

## Open questions

- The sources-line rate. Three answers in four cite everything because the
  model named nothing, so citations are the retrieved set most of the time
  and the "cite what the answer rested on" contract is mostly not met. The
  fix belongs to generation (prompt, or a structured tail), and the
  `sources_named` column measures whether it worked.
- Whether an unsourced answer should carry a marker in the widget. Not
  until the rate above is down; today it would mark most answers.

## Verify

- Migration applies to a database with existing rows; old rows read back with
  nulls and classify as before.
- An unanswerable question stores `refused`, `refusal_reason = 'no_context'`
  or `'no_grounding'` depending on whether retrieval found anything, a hit
  count and (when hits exist) a top score.
- An answerable question stores `sources_named` and a score; the model id and
  a positive latency are present. Verified on the development database:
  a refusal with eight hits and a top score of 0.067 (`no_grounding`), a
  refusal with a top score of 0.301, and an answer at 0.483 that cited all
  eight passages with `sources_named = false`, 13 s latency, model recorded.
- The widget renders its refusal copy for `no_context`.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm evals:check` unchanged.
- The gaps page flags a weak answer only on rows written after the migration.

## Measurements

**Weak-answer floor, 2026-09-10.** Retrieval-only run of the private tuning
set (99 cases, 79 answerable) under the shipped retrieval defaults, joined by
case id with the judged run of the same set (`claude-haiku-4-5` judge,
`gpt-5-mini` answering). "Wrong" is graded C or refused (13 cases); "correct"
is graded A (62 cases). Embedding model `openai/text-embedding-3-small`.

| top score | cases | A | B | C | refused |
|---|---|---|---|---|---|
| 0.00–0.30 | 4 | 2 | 1 | 1 | 0 |
| 0.30–0.40 | 24 | 18 | 0 | 3 | 3 |
| 0.40–0.50 | 33 | 27 | 2 | 2 | 2 |
| 0.50–0.60 | 14 | 12 | 1 | 0 | 1 |
| 0.60–0.70 | 4 | 3 | 0 | 1 | 0 |

| floor | flagged | wrong caught | of all wrong | correct flagged | of all correct |
|---|---|---|---|---|---|
| 0.30 | 4 | 1 | 8% | 2 | 3% |
| **0.35** | 9 | 2 | 15% | 6 | 10% |
| 0.40 | 28 | 7 | 54% | 20 | 32% |
| 0.45 | 41 | 10 | 77% | 29 | 47% |
| 0.50 | 61 | 11 | 85% | 47 | 76% |

**Default: 0.35**, the highest floor that flags at most one correct answer in
ten. The honest reading of the table is that the top retrieval score
separates wrong from right only weakly on this corpus: wrong answers sit at
every band, and the precision of "under the floor" hovers around a quarter
at every threshold. The floor is therefore a conservative catch for the
clearest cases, not the main weak-answer signal; `sources_named = false` is
expected to carry more of the weight, and its rate is now measurable. Re-run
`scripts/measure-weak-score.ts` when the corpus, the embedding model or the
retrieval defaults change; the two reports it joins must share a retrieval
configuration or the join is meaningless.
