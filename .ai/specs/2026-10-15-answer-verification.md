# Answer verification: names the answer asserts must exist in the corpus

> Status: done · 2026-10-15 — mechanics shipped default-off; Measurements below decide the default

**Goal.** An answer can name a feature, setting, button or page that the
documentation does not contain. The grounding contract tells the model to
answer only from the context, and the refusal sentinel covers the case where
it has nothing to answer from; neither covers the case where it answers from
the context and decorates the answer with a name it made up. That failure is
invisible today: the answer reads well, the citations are real, nobody
downvotes it, and the groundedness judge only runs offline. This adds a
deterministic check after generation: every product name the answer asserts
is looked up in the retrieved blocks, then in the whole corpus. A name found
nowhere makes the answer say so, in its own voice, marks the message for the
people maintaining the content, and lands on the gaps page as its own kind.
The eval harness learns to replay a follow-up turn, which is where the
failure was observed, and reports how often answers name unsupported terms.

## Design

**The corpus is the catalogue.** Nothing product-specific lives in the
prompt. Every real name is already in the index, so a name is supported when
the index contains it and unsupported when it does not. The check is
corpus-agnostic by construction and self-updating: a page added tomorrow
makes its names supported tomorrow.

**What counts as a name.** The model is asked, by a paragraph appended to the
grounding contract only when the check is on, to write the exact name of any
feature, setting, button, page or option it asserts exists in bold, as the
documentation writes it, and to bold nothing else, in particular not a name
it is saying does not exist. The extractor then takes bold spans and inline
code spans without whitespace (identifiers, flags, environment variables).
Fenced code blocks are stripped first. A candidate is kept when it is 3 to 80
characters, contains a letter, is at most eight words, is not a URL, path or
address, and carries no sentence punctuation; a trailing period is dropped,
and a short stoplist of label words (note, tip, yes, no, important, example,
warning, step) is skipped. A bold span that ends in a colon is a heading for
what follows ("**Open the attribute:** select Edit"), not a name the answer
asserts, and is skipped; a name used as a label keeps the colon outside the
bold and is checked as usual. Without this, a style that asks for bold step
titles has every title flagged that the documentation does not phrase the
same way. A path written with arrows or `>`
("Settings → Billing") is checked whole and by part. Candidates are
deduplicated by normalized form, kept in first-seen order, and capped at
twelve per answer. Double-quoted spans are not candidates yet: the model
quotes the visitor's wording paraphrased, and the false-positive rate of that
source has to be measured before it is trusted.

**Normalization matches the index.** The search column is built with a text
search configuration that lowercases, removes accents, keeps stopwords and
does not stem. The extractor normalizes the same way: compatibility
decomposition, combining marks removed, lowercase, a trailing possessive
dropped, every run of non-alphanumerics collapsed to one space. Without
stemming, plural against singular is the largest false-positive class, so a
term is checked in three variants: as written, without a trailing `s`, and
with one.

**Two passes, then a verdict.** First the names are excluded that the visitor
typed, in this message or in any earlier visitor turn the engine was given
(the visitor said it; the model echoed it), and those the project lists as
ignored terms, the same list the gaps page already honours. Earlier
assistant turns do not count: their names are the model's, and a name it
invented once must not become supported by repetition. Then each
remaining name is searched in the retrieved blocks (title and content) and
in the full text of any tool result the turn produced. Survivors go to the
corpus lookup, one statement over the chunk rows of record: a phrase query
against the search column, or a substring match on document titles, scoped
by organisation and project. The lookup is injected like the planner and the
reranker, so the engine knows nothing about where the rows live (D10), and it
reads the rows that both vector drivers share, so it behaves identically
under either (D13). A name found by neither pass is unsupported.

**Three outcomes, kept apart.** A lookup that is absent (an engine built
without one) still reports from the first pass: a host that forgot to wire
it must not get a silent no-op. A lookup that rejects or exceeds its two
second budget leaves the answer *unchecked*: no callback, no event, the
stored column stays null. The three states are null (not checked), an empty
list (checked, clean) and a non-empty list (checked, unsupported names
found), and nothing downstream may collapse the first two.

**Where it runs.** After the stream has closed and the sources line has been
resolved, before the citations event. Only answers are checked: a refusal, a
clarifying question, a turn paused on a tool confirmation and a
retrieval-only run skip the check by construction. A resumed turn retrieved
nothing (its context was built when it paused), so it skips the first pass
and goes straight to the lookup; without a lookup it is not checked. The
engine accumulates what it has emitted as it goes, through every yield site,
including the held tail that turns out to be prose, which is where the last
name in an answer often sits.

**Wire and storage.** `AnswerEvent` gains `{ type: "verification";
unsupportedTerms }`, emitted after `citations` and before `done`, and only
when the list is non-empty: a clean answer looks exactly as it does today. A
callback on the ask input reports every check that ran, clean or not, for the
same reason the sources callback exists: whether an answer was checked is
evidence for the people maintaining the content, not something the visitor
sees. The message row stores `unsupported_terms` with the three states
above. Replays carry the list, so the widget renders the same thing on a
reload that it rendered live. When a later turn loads this one as history,
the hedge sentence is appended to the assistant turn's content, so the model
sees that it already admitted the name was unverified and does not repeat it
with fresh confidence.

**What the visitor sees.** A sentence in the assistant's voice at the end of
the answer, inside the same bubble: "I couldn't find **X** in the
documentation, so that part may not be accurate." No icon, no label, no box;
the uncertainty is spoken, not flagged. The sentence is a copy key with a
`{terms}` placeholder, so an operator can reword it or make it generic. It
is rendered from the stored list, never written into the answer text, so the
answer the model wrote and the engine's verdict on it stay separate columns.

**For the people maintaining the content.** `unsupported_terms` is a gap
kind: the gaps predicate flags a row whose list is non-empty, the classifier
reports the kind after refused and marked down and before weak, the gaps
page counts it and badges it, the drawer lists the terms with how often each
was flagged, the CSV export and the task brief carry them, and the cluster
analyst is told which names the answers invented. The conversation page
badges the message, and the dashboard's "uncertain" reading, which was
refused or weak, becomes refused, weak or unsupported. The analyst's input
hash includes the signal only when it is set and the terms only when there
are any, so existing analyses are not invalidated by the column appearing.

**On by default, since measured.** `DESKBELL_VERIFY=off` disables the
check. Off, the system prompt is byte-identical to the one before this
existed, so earlier prompt fingerprints stand. On, the prompt gains a
paragraph and the answer path gains a lookup between the last token and the
citations, both of which move numbers the eval harness tracks: that is a
ranking-affecting change in the D8 sense. It shipped off, was measured, and
the default moved on the figures under Measurements.

**Evals.** A case may carry `history`: prior turns, as the engine takes
them, so a follow-up ("that setting is not in my dashboard, which one is it
then?") is asked with the scripted turn that provoked it. The in-process
target passes history through; the HTTP target cannot script prior turns and
refuses such cases with a clear error. Follow-up cases are answerable cases
whose marking criteria state the denial ("the documentation does not describe
such a setting"); the forbidden-strings check is the wrong instrument, since
a correct denial names the thing it denies. Each case records how many
unsupported terms the engine reported, a count rather than the terms, since
reports never hold answer text; the report's `unsupportedTermRate` is the
share of checked answers with at least one, lower is better, and it enters
the baseline only when a run checked something, so the fixture baseline
keeps its shape. The LLM judge is shown the prior turns when a case has them.

## Non-goals

- Regenerating the answer with the unsupported names forbidden. The tokens
  are on the wire when the check runs; a second draft needs the whole stream
  held back, which trades streaming for a chance at a cleaner answer. That is
  a separate experiment with its own numbers.
- Judging whether a real name was the *right* name. A verifier sees only
  what it is asked to check: an existing feature recommended for the wrong
  job passes it. That is retrieval's problem, or a content gap.
- Checking plain prose. Only names the model marks are checked; a name
  written without bold or code is not seen. The prompt paragraph is what
  makes marking reliable, and its reliability is one of the numbers measured.
- Stemming or language-aware matching. The index does not stem, so neither
  does the check. Inflected names in languages that decline nouns will show
  up as false positives; the rate is measured per corpus before the default
  moves.

## Open questions

- Whether double-quoted spans should become candidates once their
  false-positive rate on a real corpus is known.
- Whether a flagged name should also be offered to the visitor as "did you
  mean", from the titles the lookup found nearby. Not before the plain
  version has numbers.

## Verify

- Unit, extractor: bold and code spans extracted; fenced code ignored;
  labels, URLs, paths, addresses, numbers-only and sentence-length spans
  dropped; trailing punctuation stripped; arrow paths checked by part; dedupe
  by normalized form; cap at twelve; normalization parity with the index
  configuration (diacritics, hyphens, possessives, arrows); plural variants.
- Unit, engine: prompt byte-identical with the setting off; a name present in
  a retrieved block is clean with no event; a name the lookup finds is clean;
  a name the lookup misses yields the event after `citations` and before
  `done`; names the visitor typed, names in history and ignored terms are
  excluded; a rejecting lookup produces no callback and no event and still
  reports usage; a name in the held tail is checked; no check on a refusal,
  a clarification, a paused turn or a retrieval-only run; a resumed turn
  checks through the lookup alone; tool-result text counts as support.
- Unit, gaps: an empty list is not a gap; a non-empty list is, with its own
  kind; a refused row's list is ignored; kind precedence; counters, tallies,
  CSV column, task line, thread status, analyst hash stable when the signal
  is off.
- Unit, evals: history accepted and validated; the rate counts checked cases
  only and is null when no case was checked; the metric enters the baseline
  only then; a rise is a regression; the HTTP target refuses history cases.
- Widget DOM: the hedge renders with the terms and honours a copy override;
  the answer event carries the terms; a replayed message renders it; nothing
  renders when the list is empty.
- Database, by hand with `scripts/verify-terms.ts`: a hyphenated name, a
  plural where the docs have the singular, a name with a diacritic, a
  possessive, a symbol-only string, a string containing `%`, a name that
  appears only in a document title.
- Live: a plain question answers with no hedge and an empty list; a
  follow-up that provokes an invented name shows the hedge, stores the list,
  badges the message, counts as uncertain on the overview, appears on the
  gaps page with the badge, the terms in the drawer and the CSV, and in the
  analyst's prompt; the hourly catch-up assigns a row flagged only by terms;
  a reload replays the hedge; the next turn's history carries it.
- `pnpm evals:check` reports no change throughout.

## Measurements

The private tuning set (100 cases: 79 answerable, 21 unanswerable, one of
them a follow-up with scripted history), `gpt-5-mini` answering,
`claude-haiku-4-5` judging, run twice on 2026-10-15 with the setting off and
on. Retrieval is identical by construction (recall@8 0.882, MRR 0.685, nDCG
0.720 in both). The prompt fingerprint moves from `04c92991f470` to
`0bab550e4f1c`, which is the paragraph.

| | off | on |
|---|---:|---:|
| Factuality | 77.6% | 81.4% |
| Uncertainty | 85.7% | 85.7% |
| False-refusal rate | 10.1% | 6.3% |
| Groundedness | 95.8% | 95.9% |
| Unsupported-name rate | — | 1.3% (1 of 77 checked) |
| Output tokens, answered cases | 19,510 | 28,743 |
| Median latency, answered cases | 3101 ms | 3786 ms |
| p95 latency, answered cases | 6525 ms | 7878 ms |

**What moved.** Three answerable cases improved (two C→A, one B→A) and three
fewer answerable cases refused; nothing got worse. That is above the
generator's run-to-run noise (about two and a half points on this set), and it
came from the prompt paragraph, not the check: asked to name what it asserts,
the model answered questions it used to decline. The gain is a side effect
worth its own measurement before it is counted on.

**The one flag.** One checked answer named a standard by its number where the
documentation writes two numbers as a range ("… 14040 or 14044"). The name is
in the content, just not as a contiguous phrase, so the flag is a false alarm
of the "written differently" class. One flag is not a precision estimate; it
is one data point, and it says the next source of false alarms to look at is
numbers and codes written as ranges or alternatives. A raw substring pass over
chunk text was added to the lookup for spellings the parser joins into one
token (a slash-written range becomes a single token); it does not catch this
case, which is a range written with "or".

**The follow-up case.** Off, the engine answered a question the set marked
unanswerable. On, it answered again, naming three real rule names, every one
found in the corpus, and the check reported nothing: the corpus does hold
alternatives, and the case's label is wrong for this corpus rather than the
answer. The failure observed in the field, an invented name, did not
reproduce on this run; the case stays in the set with its note corrected.

**Latency.** Median up 685 ms and p95 up about 1.35 s on answered cases, with
output tokens up 47% on the same cases; refused cases got faster. The lookup
is one indexed query and does not account for a second of p95. The cost is
longer answers under the bold instruction, and partly the run-to-run spread of
a hosted model, which this single pair of runs cannot separate.

**Decision.** The default is **on** as of 2026-10-16. The criteria written
before the runs were: factuality within noise (met, and improved), flag
precision high (one flag, a false alarm, so unknown), p95 delta small (not
met). The flip was taken on the first two numbers, factuality and false
refusals, which moved further than the noise band and in the right direction,
accepting the latency: the slower answers are longer answers, which is the
behaviour that produced the gain, not an overhead to engineer away. Two
things remain to measure now that real traffic runs with the check on: a
second pair of runs to separate the latency of the paragraph from the day's
model latency, and the precision of the flags, from labelling the ones real
traffic produces. If precision turns out low on a corpus, the operator's
remedy is the ignored-terms list, then `off`. The controlled push-back set
(four follow-ups, real model): three refusals and one clean checked answer,
no invented names; its cases provoke refusal rather than invention on that
model, which is the better failure but not the one it was written to catch.
