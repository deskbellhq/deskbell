# Drafting an answer: the model writes the shape, a person supplies the facts

> Status: done · 2026-09-22

**Goal.** Every path out of a gap today ends with a person facing an empty
textarea. The analysis says what is missing and what a correct answer must
contain, the drawer shows the passages the engine had, and then the writing
starts from nothing. This adds **Draft with AI** to the answer form: the
model reads the cluster's questions, the retrieved passages and the analysis
and writes the answer's shape, leaving a named blank wherever the material
does not settle a fact. A person fills the blanks and saves. Unlike the
prompt the gap hands a coding agent, this one the deployment can carry out
itself, because written answers live in Deskbell and the documentation
repository does not.

## Design

**The honesty problem, and the shape of the answer to it.** A gap is by
definition a question the content could not answer, so the retrieved
passages usually do not contain the answer. A drafter that writes a fluent
answer from that material is inventing product facts, and an invented answer
indexed as a written answer is worse than no answer: it is cited, it looks
authoritative, and nobody can tell it was guessed. So the drafter is built to
refuse to invent. It writes only what the passages plainly state, and
wherever the answer needs a fact the material does not settle it writes a
blank in square brackets naming exactly what is needed — `[the file format]`,
`[where the button sits]` — and keeps the sentence around it. The person
fills blanks rather than composing prose. The model does the part it is good
at, which is shape, register and completeness; the person does the part only
they can do, which is knowing what is true.

**The blanks are returned as data, not just left in the text.** The model
returns `blanks`, one entry per bracketed blank in the order they appear.
The form lists them under the textarea, so "what is left to do" is a list
and not a hunt through prose. An empty list means the passages settled
everything, which happens on the weak-answer and downvoted clusters where
the content existed and retrieval or grounding failed.

**Where it runs.** In a server action, synchronously, not in the worker.
Analysis is a batch spend over twenty clusters and belongs in a queue; a
draft is one person waiting at one textarea, and a job would mean polling
a form. `DESKBELL_ANSWER_DRAFTER_TIMEOUT_MS` bounds it at thirty seconds
like the analyst.

**`packages/core/src/models/answer-drafter.ts`** is the model-facing half,
beside the analyst in THE model-config module (root AGENTS rule 8; D4/D13),
built by `createAnswerDrafterDeps`. It takes the same defensive posture as
the analyst: questions and passages are wrapped in tags, the prompt names
them as material rather than instructions, and the output is bound to a
schema, so an instruction hidden in a visitor's question cannot become a
field. `DESKBELL_ANSWER_DRAFTER_MODEL` picks a different model than the one
answering visitors.

**The action** re-checks the role, loads the cluster's questions, evidence
and analysis with the queries the drawer already uses, refuses when the
project's daily token budget is spent, calls the drafter, and records usage
whether or not the call succeeded — the provider counts tokens before a
timeout does. It returns a discriminated result rather than a message the
UI has to match on: `{ ok: true, answer, blanks }`, or `{ ok: false }` with
a reason of `budget`, `forbidden`, `missing` or `model`. `lib/answer-draft.ts`
holds that type and the copy for each reason, with no React in it, so the
wording is unit-tested.

**The form.** The answer textarea becomes controlled, and **Draft with AI**
sits on its label row, with the field it fills. Drafting never destroys
work: whatever the textarea held is kept, and **Undo** restores it for as
long as the draft is still the current value. The button reads "Draft with
AI" on an empty field and "Redraft" once a draft is in it. Failures show
inline under the field, in the form's own voice, and the budget refusal says
when it resets rather than only that it failed. No toast and no dialog: the
control the person pressed is where they are looking.

**Only where there is a cluster to read.** The form takes the action as a
prop, like saving. The gap drawer passes it; the answers page passes it only
for an answer that came from a cluster, and an answer written from scratch
has no material to draft from, so the button is simply absent.

## Non-goals

- Streaming the draft into the textarea token by token. An answer is a
  paragraph, the spinner is honest for the seconds it takes, and streaming
  into a controlled field the person may be editing is a race worth
  avoiding until someone asks.
- Drafting many answers at once. Analysis is the batch step; writing is the
  one a person reviews line by line.
- Saving a draft unreviewed, or marking a cluster resolved on draft. Only
  the existing save does that, and it needs a person to press it.
- Filling blanks from anywhere else in the product. The blanks are exactly
  the facts Deskbell does not hold.

## Open questions

- Whether a draft whose blanks are all filled should be offered as an eval
  case automatically. It is the moment the criteria are known to be met.

## Verify

- Unit (core): the drafter builds without constructing a model and takes its
  own model id and timeout from the environment, warning on a malformed one;
  `prepareInput` trims, dedupes and caps questions and passages; the prompt
  carries every question and passage inside tags.
- Unit (web): each failure reason has copy; the budget reason says when the
  budget resets.
- Browser: the drawer's form offers the button; with no model key configured
  the click reports a failure inline and leaves the textarea untouched; the
  answers page offers nothing for an answer with no cluster.
- By hand, with a key: draft against a refused cluster and confirm the
  answer carries bracketed blanks and invents no product facts; draft
  against a weak-answer cluster whose pages do cover the question and
  confirm it comes back with no blanks.
