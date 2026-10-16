# 2026-08-21 — Widget feedback: thumbs up/down, persisted and surfaced

**Goal**: close the "feedback buttons" gap left open by spec: mvp-end-to-end. Visitors
rate answers in the widget; the vote lands on `messages.feedback` (column exists since
the scaffold); the dashboard shows it (Overview table column already reads it, the
conversation thread gains an indicator). Feedback is the second docs-gap signal after
refusals — a thumbs-down on a confident answer is a gap a refusal never reports.

## Reference

The category convention is an upsert keyed to the answer id: one vote per answer, last
write wins, re-voting replaces rather than appends (surveyed 2026-08-21). We adopt the
upsert semantics. Where hosted widgets typically gate that write with a third-party
CAPTCHA, we bind it to the visitor's session instead — no remote dependency on the
answer path (rule 7 spirit).

## Decisions

- **Wire contract** (`@deskbell/shared`): `FeedbackRequestSchema` = `projectKey`,
  `sessionId`, `messageId`, `feedback: "up" | "down" | null` (null clears — tapping the
  active thumb un-votes). Upsert: last write wins, no history table in MVP.
- **Endpoint** `POST /api/v1/feedback`: same public posture as `/api/v1/ask` — same
  CORS/origin-allowlist skeleton, and the same LAUNCH-BLOCKING abuse-protection TODO
  applies (cheap DB write, no LLM spend, so rate limiting is less urgent but included in
  that spec's scope).
- **Authorization = possession of the session**: the update is scoped
  `messageId × org × project × conversation.sessionId × role='assistant'`. A stranger
  who scrapes a messageId cannot vote without the visitor's random sessionId. One vote
  per message (per conversation), not per voter — matches the single `feedback` column.
- **Widget UX**: thumbs appear under every completed assistant answer (refusals too —
  "was this refusal right?" is signal). Optimistic toggle; errors roll back silently.
  The `done` event's `messageId` is now stored on the message state to key the vote.
- **Downvote reasons** (same day): a thumbs-down opens an inline follow-up —
  pick one of three reasons (`incorrect` "Inaccurate", `irrelevant` "Not relevant",
  `unaddressed` "Didn't answer my question" — three reasons because they route to
  three different fixes) plus an optional
  free-text comment, both skippable. Stored as `messages.feedback_reason` +
  `messages.feedback_comment` (nullable columns rather than a JSON blob, so the Gaps
  page can query them). Upvoting or clearing the vote clears both server-side.
- **Dashboard**: thread caption shows the vote icon; Overview feedback column now
  receives real values. No filters yet.

## Out of scope

Feedback analytics/aggregates, per-visitor vote identity, rate limiting
(spec: widget-abuse-protection).
