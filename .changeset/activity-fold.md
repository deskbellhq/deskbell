---
"@deskbell/widget": minor
"@deskbell/shared": minor
---

Fold what the model did before answering under one line. Tool calls and, when the deployment streams it, the model's reasoning sit in an activity group that is open while the model works and folds to "Worked for 3s · 8 steps" once the answer starts; the visitor's toggle wins for the session. The stream contract gains a `reasoning` part, and the widget gains `activity`, `activity-summary` and `reasoning` parts plus `activityDone` and `activitySteps` copy keys.
