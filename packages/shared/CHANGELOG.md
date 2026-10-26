# @deskbell/shared

## 0.3.0

### Minor Changes

- 07324b6: Add the answer-style schema: a project's own paragraph on how the assistant should sound, trimmed and capped at 2,000 characters, which the dashboard validates on write and the engine appends to its instruction after the grounding rules.
- 8379098: A refusal can now carry `text`: the project's own reply to a question about the visitor's data that nothing on the turn could read (reason `no_access`). The widget shows it as an answer, live and on replay, and still emits `deskbell:refusal` to the host.
- 59bd632: Add the question-topics contracts: `ProjectTopicsSchema`, `parseTopics`,
  `topicsToText`, `topicKey`, `topicName` and the `topics.classify` and
  `topics.catchup` job schemas.

### Patch Changes

- 6599aa6: Render GFM pipe tables in answers (new `md-table` part) instead of showing the raw pipes. Say "1 step" rather than "1 steps" in the activity summary (new `activityStep` copy key). New parts `sidebar-head`, `sidebar-title`, `citations-label` and `feedback-label`; `sources` copy accepts `{n}`; new `feedbackPrompt` copy key, empty by default.

## 0.2.0

### Minor Changes

- 29b3fc8: Fold what the model did before answering under one line. Tool calls and, when the deployment streams it, the model's reasoning sit in an activity group that is open while the model works and folds to "Worked for 3s · 8 steps" once the answer starts; the visitor's toggle wins for the session. The stream contract gains a `reasoning` part, and the widget gains `activity`, `activity-summary` and `reasoning` parts plus `activityDone` and `activitySteps` copy keys.

## 0.1.2

### Patch Changes

- 30cf212: Ship a README with each package, and point `repository`, `homepage` and `bugs`
  at the source and the docs.

## 0.1.1

### Patch Changes

- 0a47eec: Relative imports in the published files now carry their `.js` extension, so
  `@deskbell/sdk` and `@deskbell/shared` load under plain Node as well as under a
  bundler. 0.1.0 failed with "Cannot find module" when imported from Node directly.

## 0.1.0

### Minor Changes

- c2e2fe8: First publishable versions. The widget installs from npm as `@deskbell/widget`,
  the SDK wraps every public endpoint, and the widget runs on it.
