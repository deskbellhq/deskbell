# Question topics

> Status: in progress · 2026-10-23

**Goal.** Group what visitors ask into topics the operator names, so the dashboard can say "a third of the questions this month were about exports" rather than listing ten thousand questions. Each visitor question gets one label from the project's list, written by the chat model off the visitor's path, and the Usage page counts by it.

## Design

**The list is the operator's.** `projects.topics` holds up to 20 `{ key, name, description }` entries, validated by `ProjectTopicsSchema` in `@deskbell/shared`. The key derives from the name (`topicKey`: lower-case, diacritics folded, hyphenated, letter-first) and is what messages store; the name is what the dashboard shows; the description is what the classifier is told, so writing it is writing the rule. One bucket is built in and never configurable: `other`, for a question that fits nothing on the list. An empty list means no labelling and no model call — a project that never sets topics pays nothing.

Settings › Topics is a textarea, one topic per line as `Name: description` (`parseTopics` / `topicsToText`), admin-gated like the gap settings. Renaming a topic changes its key, so the page offers **Re-label**: it clears every label in the project and queues the catch-up, which labels everything again against the current list.

**The label.** `messages.topic text`, null until written, only on user rows. The classifier (`packages/core/src/models/question-classifier.ts`, part of the model-config module like the titler) receives the topic list, the question and the visitor's previous question in the thread — a follow-up like "and for CSV?" is about what came before — and answers with a key. `pickTopicKey` matches the reply against the list leniently about dressing and strictly about the key; anything else is `other`. The reply is one token, so the cost per question is the prompt: the list plus two short turns.

**Two jobs, one handler.** `topics.classify` is enqueued by the ask route after the visitor's message is stored, only when the project has topics, with the queue failure logged and never surfaced. `topics.catchup` runs hourly for every project with topics and once for one project after a re-label; it labels unlabelled questions oldest first, capped per run so a backlog from a newly configured list is worked through over a few hours on the serial worker. Both are budget-checked against the project's daily token budget and record usage; a budget refusal ends the project's run for the hour. A row that already has a label is never relabelled, so retries and the catch-up are no-ops for it.

A partial index on `(conversation_id, created_at) where role = 'user' and topic is null` keeps the hourly scan cheap once a project is caught up.

## Non-goals

- Several labels per question, or a confidence. One key; "it is about two things" is `other` or a better list.
- Automatic topic discovery. Clustering the `other` bucket into candidate topics is a plausible follow-up on the gap-cluster machinery; this unit ships the operator-named list only.
- Intent or sentiment labels (how-to vs troubleshooting, pushback, wanting a human). A second fixed vocabulary on the same call is cheap to add later and is left out until topics have labelled real traffic.
- Labelling assistant turns. The question carries the topic; the answer inherits it through the conversation.

## Open questions

- Whether the previous *answer* should also go into the classifier's input. The previous question covers "do it for me"; an answer would help "that didn't work" but doubles the prompt.

## Verify

- Unit: `topics.test.ts` in shared (parsing, keys, limits, round-trip); `question-classifier.test.ts` in core (prompt shape, key matching); `classify-question.test.ts` and `topics-catchup.test.ts` in the worker (budget, missing, usage recorded even on a failed save, cap, per-project stop).
- Browser: Settings › Topics saves a list and reloads it; the Usage page groups seeded labelled questions by topic.
- Live: set three topics on a project, ask two questions and a follow-up; within a minute all three carry a label, and the follow-up carries its predecessor's.
