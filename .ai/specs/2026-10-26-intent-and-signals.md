# Intent and signals

> Status: in progress · 2026-10-26

**Goal.** Say why a visitor asked and how it went for them, not only what the question was about. Topics (spec: question-topics) are the operator's vocabulary for *what*; this unit adds two fixed vocabularies from the same model call: one **intent** per question (why they asked) and zero or more **signals** (how it went: they pushed back, they were frustrated, they asked for a person). The Usage page counts both, the Conversations page filters on both, and the thread shows them beside each question.

## Design

**A fixed list, not a project-named one.** Topics differ per product, so the operator names them. Intents and signals are the same for every product, so they are constants in `@deskbell/shared` (`INTENTS`, `SIGNALS`, with a name and a one-sentence rule each) that the dashboard can name, document and colour without configuration. Six intents: `how_to`, `troubleshooting`, `lookup`, `request` (asks for something the product does not do), `off_topic`, `other`. Three signals: `pushback` (repeats or disputes the previous answer), `frustration`, `wants_human`. Every added class costs labelled examples and lowers agreement, so the lists grow only with a measured reason.

**One call, one JSON object.** The question classifier (`packages/core/src/models/question-classifier.ts`) is told the intent and signal rules once, in its system prompt, and the project's topics per call; it answers `{ "topic", "intent", "signals" }`. The parse is strict about keys and lenient about dressing: the first JSON object in the reply is read, an unknown intent is `other`, an unknown signal is dropped, and a reply that is not JSON at all falls back to the old one-token topic match with `other` and no signals. The visitor's previous question stays in the prompt; it is what makes `pushback` decidable, and the prompt says so: no previous question, no pushback. The project's name goes in as `<product>`, because "off topic" needs something to be off; without it the first run read a weather question as a lookup. Intent is judged from the question's form, never from what the product can do — the classifier does not see the documentation, so "can it…" is a lookup and a wish is a request, whatever the answer turns out to be. A project without topics omits the topic list and gets a null topic — intent and signals never depend on a topic list existing.

**Storage.** `messages.intent text` and `messages.signals text[]`, both null until the worker runs, only on user rows. "Labelled" now means `intent is not null`; a topic may legitimately be null on a project with no topics. The catch-up predicate is `role = 'user' and (intent is null or topic is null)` — the topic half keeps the behaviour that a newly named topic list is applied to the backlog within a few hours — and the partial index is rebuilt on it. One migration.

**One switch.** `projects.classify_questions boolean not null default true` is the only setting: the ask route enqueues the job for every question while it is on, the hourly catch-up lists the projects it is on for, and the worker refuses a job for a project it is off for. It exists because a self-hoster may want no model spend per question at all; it is on by default because intent and signals need no configuration to be useful. Off means topics are not labelled either — there is one call, and the switch is whether it is made. The switch sits at the top of Settings › Topics, which is now the page for everything the classifier writes. Re-label clears all three columns.

**Usage page.** Two sections after Topics, built from the same table: **Intent**, one row per intent with questions, share, delta, conversations, a column per series when split, and a composition bar when not; **Signals**, one row per signal, the same columns, with "none" never a row — the share is of every question in the period. Each row is a door into Conversations. Each section opens with one sentence: Intent names the leader and the share of `request` (the product signal); Signals names the largest signal or says there were none. A project with the switch off and nothing labelled sees a card pointing at the setting.

**Conversations.** `?intent=<key>` and `?signal=<key>` narrow the list the way `?topic=` does — a thread with at least one question carrying the label — with chips that name them. The inbox row carries a small glyph for `wants_human` and `pushback` only, the two that ask to be read. In the thread each visitor message shows its intent and its signals as badges beside the time, each with its rule as the tooltip.

**Verify before rollout.** A labelled set of real questions, each with an intent and signals from two people, is the measure; agreement between the two people is the ceiling. `scripts/classify-evals.ts` runs the classifier over a JSONL file of `{ question, previous?, intent, signals }` lines with no topics and reports intent agreement, per-signal precision and recall, and the intent confusion table, against the thresholds the prompt has to clear: intent agreement ≥ 0.8, `wants_human` precision ≥ 0.9 (a false "wants a human" is the costly error), `pushback` recall ≥ 0.7. Below them, the prompt is fixed, not the taxonomy. The scoring is pure and tested (`packages/evals/src/classification.ts`); a real set built from a deployment's traffic lives in `datasets/private/` like every other set that cannot be republished, and the committed `datasets/intents.jsonl` is a small authored set that exercises the script, not a quality claim. On that set the default chat model clears the gate once the product is named; the first run, without a product name and with `request` defined by a fact the model cannot know, did not — which is what the set is for.

## Non-goals

- Project-named intents or signals. A product with its own classes names topics; the fixed lists are what make the dashboard able to explain them.
- Sentiment scores, satisfaction estimates, or any modelled number. `wants_human`, `pushback`, downvotes and refusals are inputs a self-serve rate could be built from later; this unit stores the facts.
- A notification on `wants_human`. The channel-first notification model (spec: project-notifications) takes a new event in one place; it is the natural follow-up once the signal's precision is measured, not before.
- Per-conversation human tags. Gaps carry resolve/reopen state; hand-tagging threads is a different feature.

## Open questions

- Whether the previous *answer* should join the prompt. It would make `pushback` and `frustration` sharper on "that didn't work" and doubles the prompt; the labelled set decides.

## Verify

- Unit: `intents.test.ts` in shared (keys, names, schemas); `question-classifier.test.ts` in core (prompt shape, JSON parse, fallbacks); `classify-question.test.ts` and `topics-catchup.test.ts` in the worker (all three fields saved, the switch, the predicate); `conversations-view.test.ts` (the two filters); `classification.test.ts` in evals (agreement, precision, recall, confusion).
- Browser: seeded questions carry intents and signals; the two Usage sections count them, a row opens the narrowed inbox with its chip, the thread shows the badges, the settings switch saves.
- Live: ask a how-to, a "no, I meant…" follow-up and "can I talk to someone"; within a minute the thread shows `how_to`, `pushback` and `wants_human`.
