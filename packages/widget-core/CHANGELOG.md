# @deskbell/widget

## 0.2.0

### Minor Changes

- 29b3fc8: Fold what the model did before answering under one line. Tool calls and, when the deployment streams it, the model's reasoning sit in an activity group that is open while the model works and folds to "Worked for 3s · 8 steps" once the answer starts; the visitor's toggle wins for the session. The stream contract gains a `reasoning` part, and the widget gains `activity`, `activity-summary` and `reasoning` parts plus `activityDone` and `activitySteps` copy keys.

### Patch Changes

- b618065: Clear the typing indicator when a stream ends without text, so an answer that spent every step on tools no longer spins forever.
- Updated dependencies [29b3fc8]
  - @deskbell/shared@0.2.0
  - @deskbell/sdk@0.2.0

## 0.1.2

### Patch Changes

- 30cf212: Ship a README with each package, and point `repository`, `homepage` and `bugs`
  at the source and the docs.
- Updated dependencies [30cf212]
  - @deskbell/sdk@0.1.2
  - @deskbell/shared@0.1.2

## 0.1.1

### Patch Changes

- 0a47eec: Relative imports in the published files now carry their `.js` extension, so
  `@deskbell/sdk` and `@deskbell/shared` load under plain Node as well as under a
  bundler. 0.1.0 failed with "Cannot find module" when imported from Node directly.
- Updated dependencies [0a47eec]
  - @deskbell/sdk@0.1.1
  - @deskbell/shared@0.1.1

## 0.1.0

### Minor Changes

- c2e2fe8: First publishable versions. The widget installs from npm as `@deskbell/widget`,
  the SDK wraps every public endpoint, and the widget runs on it.

### Patch Changes

- Updated dependencies [c2e2fe8]
  - @deskbell/sdk@0.1.0
  - @deskbell/shared@0.1.0
