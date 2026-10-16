# Eval measurement fixes — judge structure, retrieval-only runs, provenance

Status: shipped
Touches: `packages/evals`, `packages/core` (one additive `AskInput` field), `scripts/`

An audit of the harness found seven defects that all share a shape: the numbers it
reports are not measuring quite what they claim to measure. None is a crash, and
every one of them silently biases a decision the harness exists to inform.

## 1. The judge decides the grade; it should only decide the facts

`Judge` returned a letter grade chosen by the model, plus `matchedFacts` /
`missingFacts` that were then thrown away. Two problems follow from that shape.

**The B boundary is a judgement nobody can validate.** A/B/C asks a model to
locate an answer on a three-point ordinal. Checking whether it agrees with a
human then means checking agreement at every boundary, and the A/B boundary is
the subjective one — "the key fact is present but supporting detail is missing"
is a summary, not an observation. A per-criterion question ("is this fact
present in this answer, yes or no?") is answerable, checkable, and is what the
judge was already being asked for on the side.

**The rubric leaked groundedness into the grade.** The same call asked for a
grade *and* for groundedness, and a model told to "grade strictly" reads an
ungrounded-but-correct answer as a failure. That directly contradicts the
package's own rule that Factuality and Uncertainty are never blended — the
blend was happening one level down, inside the judge, before either number was
reported.

**Change.** The judge now returns one boolean per marking criterion, plus a
separate groundedness boolean, plus its reason — in that order, so the
justification follows the evidence rather than preceding it. The prompt states
explicitly that groundedness must not affect fact matching, and gives the
`present: true, grounded: false` case by name. The letter grade is **derived in
code** from the booleans (all present → A; key fact present → B; otherwise C),
so both judges now produce grades by the same rule and differ only in how they
decide presence. The deterministic judge is unchanged in behaviour; it was
already doing exactly this.

## 2. Factuality was a mean of an ordinal

`factuality` averaged `A=1 / B=0.5 / C=0`. A mean over an ordinal treats the
A→B gap as equal to the B→C gap, which nothing justifies, and it moves in
half-steps regardless of how many criteria a case carries: a case missing one
fact of two and a case missing one of six both score 0.5.

**Change.** Factuality is now the mean **fact coverage** — matched criteria
divided by required criteria, per case, refusal scoring 0. It is a mean of
binary judgements, which is a proportion with a meaning. The letter grade
survives where it is actually useful: as the per-case outcome the baseline gate
diffs, where "this case got worse" is the whole question.

The fixture baseline is unchanged by this — every fixture case matches all its
criteria, so coverage and grade agree at 1.0. Any set with partial matches will
report a different (more precise) number than before.

## 3. Nothing measured the judge

A judge is a second system, and this one had no accuracy. `--labels <path>`
takes a JSON map of case id to human grade and reports agreement against it:
exact-grade agreement, binary agreement (acceptable vs not), and the
disagreements themselves. Alignment is deliberately **not** written to the
baseline — it is a property of a judge and a label file, not of the system under
test, and gating on it would make relabelling look like a regression.

Also reported: `judgeAnomalies`, the count of answerable cases where the judge
returned a fact that is not one of the case's criteria. That needs no labels and
catches a judge paraphrasing the marking scheme instead of applying it.

## 4. Retrieval tuning paid for generation it never read

recall@k, MRR and nDCG@k depend on nothing that happens after retrieval, and a
configuration sweep is many runs that differ only in retrieval. Every one of
them was generating a full answer per case and throwing it away.

**Change.** `--retrieval-only` stops each case after retrieval. In core this is
one additive `AskInput.retrievalOnly` field, returning immediately after the
existing `onRetrieval` callback fires and before any context is built — the same
seam and the same justification as `onRetrieval` itself. The judge is never
constructed, quality metrics report as unassessed rather than as zero, and
`--check` / `--update-baseline` are refused in this mode so a partial run can
never overwrite a full baseline.

`pnpm sweep` now uses it by default, and only runs generation when `--judge` is
passed explicitly.

## 5. A case that retrieved nothing was dropped from recall

Retrieval was scored only when the target returned at least one chunk, and the
aggregate then averaged over "cases that have a retrieval score". A case where
retrieval came back empty vanished from the denominator instead of scoring zero
— so a change that makes retrieval return nothing on the hardest questions
*raises* reported recall.

Harmless while the similarity floor defaults to off. Exactly wrong during a
`--min-score` sweep, or under a rerank-stage floor, which is when the number
would be load-bearing.

**Change.** A case with labels is scored on what retrieval returned, including
when that is nothing.

## 6. Nothing said how much of the slate was junk

recall/MRR/nDCG all answer "did the right document appear, and how high". None
answers "how much of what we paid for was irrelevant" — which is the quantity
document-level capping exists to move. `precisionAtK` (relevant documents over
documents returned) is added alongside them.

*Not changed, having been checked:* the ideal DCG runs over
`min(relevant.size, k)`, which is correct. `k` bounds chunks and each document
occupies at least one chunk, so it is a true bound on the documents a perfect
ranking could surface.

## 7. A run could not say which prompt produced it

The grounding contract is exported from core so a run can record which prompt
produced its numbers; nothing imported it. A prompt edit moved every quality
number with no trace in the report or the baseline.

**Change.** Reports and baselines carry `promptHash`, the first 12 hex
characters of the SHA-256 of the system prompt the run used. A change reports as
a *change*, never a regression — a different prompt is a different measurement,
not a worse one. The hash covers the prompt the CLI can produce; an engine
constructed in code with `EngineOptions.systemPrompt` is outside what the
harness can see, and the field is omitted for targets that cannot know
(`--target http`).

## 8. Failure modes were counted by hand or not at all

`EvalCase.tags` is an optional list of failure-mode labels, and the report prints
their frequency across cases scoring below full marks. Counting which modes
dominate is what decides where engineering goes; doing it in a spreadsheet after
every run is how it stops being done.

## Deliberately not in this change

- **Mining cases from recorded traffic.** `EvalCaseSource.kind: "real"` and
  `messageId` exist and nothing writes them. The conversion path belongs with
  the operator surface that reviews a candidate before it becomes a case, not
  with a script that guesses.
- **An annotation tool.** Labelling by hand-editing JSON is the real bottleneck
  in building a set, and `--labels` above is a file format, not a UI.
- **Trace emission.** Separate work with its own dependency question.
- **A saturating fixture.** The fixture reports full marks on every metric, so
  the gate detects breakage and cannot detect improvement. That is a property of
  a four-document controlled corpus and is documented rather than fixed.

## Verification

- **The Factuality redefinition is baseline-neutral on the fixture.** Regenerating
  `baselines/fixture.json` added exactly two lines — `promptHash` and
  `retrieval.precisionAtK` — and moved no existing number. Every fixture case
  matches all its criteria, so coverage and the letter agree at 1.0; a set with
  partial matches is where the two diverge.
- **`--retrieval-only` measures the same retrieval for no generation.** The fixture
  reports recall 1.000 / precision 0.444 / MRR 0.967 / nDCG 0.975 in both modes,
  at 42,004 input and 2,440 output tokens in a full run against **0 and 0** in a
  retrieval-only one. Embedding tokens are identical (887), which is the check
  that retrieval really ran.
- **The empty-versus-unobservable distinction is pinned by test**, at the metric
  and at the run level, in both directions.
- **`--check` and `--update-baseline` are refused** in retrieval-only mode, and
  `--retrieval-only` is refused on the HTTP target.
- **Alignment works end to end**: three hand-written labels against the fixture
  reported 33.3% exact / 33.3% binary with both disagreements named.
- **precision@8 is 0.444 on the fixture** — the first metric there that is not
  saturated, so the gate now has one number with room to improve as well as to
  break.
- 357 tests green repo-wide (100 in `packages/evals`), typecheck 15/15, Biome
  clean, production build green, `pnpm evals:check` reports no change.
