# Own-data fallback: one honest reply when the question needs the visitor's data

> Status: done · 2026-10-23

**Goal.** Visitors ask the widget about their own account: why their score
is what it is, which settings are on their record, why something of theirs
stopped working this morning. The widget answers from documentation, and on
a turn with no tools it cannot see any of that. With good pages about the
feature retrieved, the model's instinct is to write a diagnosis as if it had
looked, which is the worst answer it can give; without them it refuses, and
the refusal lands on the Gaps page as a page nobody can write. This gives a
project one configured reply for that class of question, shown verbatim in
the assistant's voice, recorded as its own refusal reason so it is counted
without being mistaken for a documentation gap. On a turn with tools the
engine already routes own-data questions to a tool, so the rule never
applies there and nothing has to be removed when a project wires actions.

## Design

**A prompt rule, not a classifier.** A keyword match before retrieval is
brittle in both directions ("how do I improve my score" is a documentation
question; "is it ready to go live" is not), and a classification call is a
model round trip on every ask. The model already separates "how does X
work" from "what is X on my account" well enough, so the rule is one
paragraph appended to the grounding contract, and the eval cases below are
what make it measurable.

**A second sentinel, never a verbatim reply.** The paragraph tells the model
to respond with exactly `NO_ACCESS` when the visitor asks what is true in
their own account and the context cannot answer without that data. The
engine recognises the word the way it recognises `NO_GROUNDING`: held at the
start of the stream until it cannot be the sentinel, withdrawn when it
arrives after a sentence, held for one token when a trailing prefix could
still become it, left alone inside another word. The outcome is a refusal
event with reason `no_access`. The model never writes the reply, so it is
reproduced exactly, no style instruction fights it, and verification has
nothing to check. The host supplies the text.

**Carve-outs in the same paragraph.** A question about how the product
works, or how to do something, is a documentation question even when it
mentions the visitor's own account. A request to change something in the
visitor's account is answered with the documented steps for doing it
themselves, never with a claim that a change was made. Once the visitor has
shared the details (their settings, the values, the error), the model works
with what they shared instead of responding with the sentinel again.

**Only when configured, only without tools.** The engine takes a plain
option, `ownDataFallback`, like `clarify` and `verify`: off by default, and
off the system prompt is byte-identical to the one before this existed, so
every prompt fingerprint stands (D8). The ask route sets it when the
project's reply is non-empty. On a turn with tools the paragraph is not
appended and the sentinel is not recognised, because the tools contract
already says an own-data question is answered by calling a tool first. A
project that wires actions later changes nothing here: the rule drops out
per turn, and a project that never wires them keeps it.

**The reply is the host's.** The project row gains an `answering` JSON
column, validated with `ProjectAnsweringSchema` on write, holding
`ownDataReply`: up to 1000 characters, trimmed, absent when empty. Nothing
ships a default sentence; the setting is empty until an admin writes one
under Settings › Visitor data. The reply is server state, never served by the
public config endpoint: the widget receives it on the event, not in its
configuration.

**Wire, storage, replay.** `RefusalReason` gains `no_access`, and the
refusal event gains an optional `text`: the reply the visitor is shown
instead of the refusal copy. The ask route stores the row refused, with
reason `no_access` and the reply as its content. This is the one refusal
that persists text, deliberately: the replay route hands rows back as they
are, the widget shows a refused row with content as an answer bubble, the
dashboard thread shows what the visitor read, and the next turn loads it as
history, which is how the model knows it already said so and does not
repeat it once the visitor shares details. The widget renders a refusal
event carrying `text` as an ordinary assistant message, Markdown and all,
and still emits the `refusal` host event with its reason.

**Counted, not a gap.** The row is a refusal everywhere a refusal is shown:
the Conversations badge reads **No access to visitor data**, the overview
and the inbox count it as uncertain, since the question was not answered
from the content. It is not a gap: `no_access` joins `guardrail` and
`off_topic` in the reasons the gap predicate and `classifyAnswer` exclude,
so the Gaps page, the export and the cluster worker never see it. How often
it fires is a count over the column, which is the number that says whether
wiring an action for that data is worth it.

**Evals.** A dataset of unanswerable cases asks about the visitor's own
account against the controlled corpus, and answerable cases hold the
carve-out: how to do the same things, with the pages that document them.
The engine option is set from the environment like the other two
(`DESKBELL_OWN_DATA=on`), so a project run measures what the product would
do. The fixture's stub generator cannot emit the sentinel, so the set
requires a real model and never gates CI, like `pushback`.

## Non-goals

- Counting the reply as an answer. The visitor did not get one from the
  content; uncertain is the honest reading.
- A default sentence. What a project can and cannot see is the project's
  to say.
- Telling the visitor later when access arrives. Nothing records who was
  told; the count is per project, not per visitor.
- Changing the tools contract. The own-data rule is the no-tools half of a
  rule that already exists on the other side.

## Open questions

None.

## Verify

- `buildSystemPrompt({})` is byte-identical to `SYSTEM_PROMPT`; with
  `ownData` it appends `OWN_DATA_PROMPT` after verification.
- With the option on and no tools, a stream of `NO_ACCESS` (whole, across
  tokens, after a sentence, wrapped in whitespace) yields `{ type:
  "refusal", reason: "no_access" }` and no text; `NO_GROUNDING` still
  yields `no_grounding`; a trailing `NO_` is held one token and released as
  prose; `ANNO_ACCESS_X` is text.
- With the option off, `NO_ACCESS` is ordinary text. With tools on the
  turn, the paragraph is absent and `NO_ACCESS` is ordinary text.
- `classifyAnswer` on a refused row with reason `no_access` has no gap
  kind; the SQL predicate agrees; `refusalLabel("no_access")` reads
  **No access to visitor data**.
- The widget renders a refusal event with `text` as an answer bubble and a
  replayed refused row with content the same way; a refused row without
  content still shows the refusal copy.
- Settings › Visitor data saves the reply, clears it, and refuses one over the
  limit; the sidebar lists the page for admins.
