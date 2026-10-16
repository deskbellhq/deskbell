# Clarifying questions when the context forks

> Status: done · 2026-09-22

**Goal.** Today the engine has two outcomes: answer from the context, or refuse
with `NO_GROUNDING`. A question the visitor left under-specified — "how do I
configure it?" when the context holds three pages that each configure something
different — falls between them. The model either picks one reading and answers
it with full confidence, which reads as a wrong answer to the visitor who meant
another, or refuses a question the docs do answer. This adds a third outcome:
when the retrieved context itself shows a fork, the engine asks one question
back and offers the readings as options taken from the context. It never asks
about things the corpus does not contain, and never asks twice in a thread.

## Design

**A sentinel, like the refusal.** The system prompt gains a paragraph, appended
only when clarification is on, that tells the model to respond with `CLARIFY`
on the first line and one line of JSON — `{"question": "…", "options": ["…"]}` —
when the context answers the question in more than one way and the conversation
does not settle which. Each option must be the title of a context block, copied
exactly. The engine holds the stream from its first token, as it already does
for `NO_GROUNDING`; a stream that starts with the sentinel is machine output and
never reaches the client as text. It is parsed once the stream ends.

**Grounded or nothing.** The parsed options are matched against the titles of
the retrieved blocks, case- and whitespace-insensitively; an option that names
nothing retrieved is dropped. Fewer than two survivors, malformed JSON, or an
empty question all resolve to a `no_grounding` refusal with a warning in the
log — the model declined to answer from the context, which is what a refusal
records, and the row lands on the gaps page where a maintainer can see it. A
clarification is therefore something the engine can verify against the
retrieval it just did, not something it takes on the model's word.

**Ask once.** History turns carry a `clarified` flag. When any prior assistant
turn in the window was a clarification, the prompt paragraph is replaced by one
telling the model not to ask again and to answer the most likely reading, and a
second `CLARIFY` is refused the same way as a malformed one. The visitor's pick
arrives as an ordinary next message: the planner resolves it against the
clarifying turn, retrieval searches the resolved question, and the answer
follows. Nothing new is needed on the wire for the reply.

**Wire and storage.** `AnswerEvent` gains `{ type: "clarify"; question; options }`,
emitted in place of `token`/`citations` and followed by `done`. The ask route
stores the turn as an assistant message with `clarified = true`, `refused =
false`, content rendered as the question followed by the options as a list (so
the replay and the model's history both read it), no citations, and the
retrieval signal columns as on any answer. Clarifications are never gaps: not
refusals, and excluded from the weak-answer floor, which is a property of an
answer. Downvotes still count.

**Widget.** The clarify event lands in the assistant bubble as the question,
with the options rendered as buttons under it (parts `clarify-options` and
`clarify-option`) while it is the latest message. A tap sends the option text as
the next question. Replayed history shows the stored text; the buttons are live
only.

**Off by default.** `DESKBELL_CLARIFY=on` enables it. With it off the system
prompt is byte-identical to before, so the fixture baseline and every prompt
hash stand. Turning it on is ranking-affecting in the D8 sense: it changes what
the visitor gets, and it flips only against eval numbers.

**Evals.** A fourth case kind, `ambiguous`, carries `expectedOptions`: the case
passes when the engine clarified and every expected option is among those
offered. `Clarification` reports the share of ambiguous cases that passed;
`Clarify rate` reports the share of answerable cases that asked instead of
answering, kept apart from the false-refusal rate the way uncertainty is kept
apart from factuality. Both reach the baseline only when a run has something to
say about them. `datasets/ambiguous.json` needs a real model, like the injection
set: the stub generator never asks.

## Non-goals

- Learning a default from the visitor's pick. The pick is a message in one
  thread; nothing is persisted across threads.
- Asking open-ended questions. An option is always a page the corpus holds.
- Clarifying from the planner, before retrieval. The planner is forbidden from
  adding what the visitor did not say; the fork has to be visible in what was
  retrieved.

## Open questions

- Whether options should carry the block's URL so the widget can offer "read
  this page" beside "answer for this". Not until the plain version has numbers.

## Verify

- Unit: sentinel across split tokens; malformed JSON → refusal; options
  filtered to retrieved titles; fewer than two → refusal; second ask → refusal;
  prompt byte-identical with the flag off.
- Widget DOM test: clarify event renders buttons; a tap asks the option.
- Evals: `pnpm evals:check` unchanged; ambiguous set runs with `--real-model`
  and `DESKBELL_CLARIFY=on`.
- Live: fork question → options → pick → cited answer; conversation page shows
  the clarification badge; gaps page does not count it.

## Measurements

The private tuning set (99 cases: 79 answerable, 20 unanswerable, no
ambiguous cases), `gpt-5-mini` answering, `claude-haiku-4-5` judging, run
twice on 2026-09-22 with the setting off and on. Retrieval is identical by
construction (recall@8 0.882, MRR 0.685, nDCG 0.720 in both).

| | off | on |
|---|---:|---:|
| Factuality | 79.3% | 75.4% |
| Uncertainty | 90.0% | 90.0% |
| False-refusal rate | 7.6% | 7.6% |
| Clarify rate | — | 5.1% (4 of 79) |
| Groundedness | 93.2% | 95.7% |
| Median latency | 4040 ms | 3727 ms |

Of the four answerable cases that asked, two were graded A with the setting
off and two were C (one refusal, one wrong count). Four unrelated cases moved
between the runs in both directions, which is the generator's run-to-run
noise, so roughly two and a half points of the factuality drop belong to the
setting. Re-asking the four questions twice each showed the ask itself is
unstable: two of the four answered on one re-ask and asked on the other.

What the asks looked like: an import question ("can you pull from SFTP")
offered an export page and a hosted-FTP page beside the import page; a
question already settled by its wording offered a feature page and its
release-notes entry as two readings. Neither is a fork the visitor left open.
The prompt as written lets the model hedge with a question where the
question's own wording, or the fact that one candidate is a changelog entry
for the other, already settles it.

**Outcome: the default stays off.** This set measures the cost only — it has
no ambiguous cases, so the benefit side is unmeasured. Before re-measuring:
tighten the contract (never ask when the question names the direction or
action; a release-notes page is never a reading of its own), and author an
ambiguous set from real questions so both sides are on the table.
