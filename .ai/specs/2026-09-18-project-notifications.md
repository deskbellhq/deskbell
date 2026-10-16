# Project notifications

> Status: in progress · 2026-09-18

**Goal.** A visitor who marks an answer down is the strongest quality signal
the product has, and today it is visible only to someone who opens the
dashboard. This spec adds project notifications: a small events × channels
subsystem in the worker that posts a Slack message and/or a signed JSON
webhook when something worth a human's attention happens. The first event is
`feedback.negative`. The shape is generic so the next event (a new gap
cluster, a source that failed to sync) is a union member and a builder, and
the next channel (email through the existing mailer, a chat product with its
own card format) is one file and one settings field.

## Design

**Three seams.**

1. *Events* (`@deskbell/shared`, `notifications.ts`): a discriminated union
   `NotificationEvent` with a stable envelope — `id`, `type`, `version`,
   `createdAt`, `project`, `url` — and a per-type `data` body. The
   `NOTIFICATION_EVENT_TYPES` list drives the settings toggles, the zod
   schema and the exhaustiveness checks in every renderer.
2. *Channels* (`apps/worker/src/notifications/channels/`): a
   `NotificationChannel` renders an event into its own payload and delivers
   it to a target. `slack` renders Block Kit and posts to an incoming
   webhook; `webhook` posts the event JSON unchanged, signed. A channel
   returns `delivered` or `rejected` and throws for anything worth retrying.
3. *Builders* (`apps/worker/src/notifications/events/`): one per event type,
   from a subject reference (`{ messageId, conversationId }`) to an event or
   `null`. The job carries the subject, never the rendered event, so the
   worker reads current state: a vote withdrawn before the job ran produces
   nothing.

**Settings.** `projects.notifications` jsonb, validated by
`ProjectNotificationsSchema`: `channels.slack.webhookUrl`,
`channels.webhook.url` + `signingSecret`, per-channel `events` toggles
(default on), and `conversationLinkTemplate`. The public config endpoint
serves `appearance` only, so nothing here reaches a browser. Webhook URLs and
the signing secret are bearer-equivalent: the settings page shows them masked
(`https://hooks.slack.com/…`, `whsec_…`), never sends the stored value to the
client, and saving an empty field keeps what is stored. Admin-gated, like the
allowlist and the token budget.

**Queue.** One queue, `notifications.deliver`, payload `{ orgId, projectId,
event, subject, baseUrl }`. The feedback route enqueues on a thumbs-down when
the project has a channel with that event on, in a try/catch that never
touches the response. First queue in the repo to pass pg-boss options:
`singletonKey` (`event:subjectKey`) collapses a down→up→down toggle while a
job is still queued; `retryLimit: 3` with exponential backoff from 30 s;
`expireInSeconds: 60` bounds one attempt.

**Delivery state.** `notification_deliveries`, one row per (project, event,
subject, channel), status `delivered` or `rejected`, attempts, error. The
dispatcher skips channels already delivered, so a retry after a partial
failure re-sends only the channel that failed. It is also what the settings
page reads for "Delivered 2 min ago" / "Failed: 503 after 3 attempts".

**Failure policy.** A `5xx`, `429`, network error or timeout throws and
pg-boss retries. The event is rebuilt on each attempt — the id is derived
from the subject so the delivery header stays the same, but the summary is
written again, a cost bounded by the retry limit. Any other `4xx`, and any `3xx` (redirects are not followed),
records `rejected` and stops: a wrong URL does not get three more tries. The
dispatcher records every channel that succeeded before rethrowing for the
one that did not.

**Base URL.** The conversation link is built from `DESKBELL_PUBLIC_URL`, else
`BETTER_AUTH_URL`, resolved in the web app and carried in the job. Never from
request headers: the feedback endpoint is public, and a spoofed `Host` must
not choose the link a support agent clicks.

**Link template.** `{conversationId}`, `{context.<key>.id}` and
`{context.<key>.name}` substitute URL-encoded into a per-project template
for hosts with their own conversation view; without a template the link is
the dashboard's conversation page. An unresolvable placeholder falls back to
the dashboard link rather than emitting a broken URL.

**Summary.** One sentence written by the chat model from the question, the
answer, the reason and the comment, so the message reads without opening the
thread. Best-effort: budget-checked, 15 s timeout, any failure falls back to
the conversation title, then the question. `DESKBELL_NOTIFICATION_SUMMARY=none`
turns the model call off without turning notifications off.

**Slack message templates.** Each event has an optional per-channel mrkdwn
template on the Slack target; empty means the built-in layout. Placeholders
are the event's scalars flattened (`NOTIFICATION_PLACEHOLDERS`), plus
`context.<key>.id|name` and `context`; a save refuses unknown ones. A
template renders as one section with substituted values escaped, and the
Open conversation button is always appended. The vocabulary lives in the
shared package so the settings validation, the renderer and the docs read
one list; a second channel with a text format reuses it unchanged.

**Slack payload.** A top-level `text` for push notifications, then blocks:
header, the question as a quote, reason and comment fields, one field per
context key (name and id), the summary, an "Open conversation" button and a
context line with the message id and time. Visitor and model text is escaped
(`&`, `<`, `>`) before it goes into mrkdwn, otherwise a comment containing a
Slack link markup renders as a link in the operator's channel.

**Webhook payload.** The `NotificationEvent` JSON, with `content-type`,
`user-agent: deskbell/notifications`, `x-deskbell-event`,
`x-deskbell-delivery` (the event id; the receiver's idempotency key),
`x-deskbell-timestamp` (unix ms) and `x-deskbell-signature`
(`v1=` + hex HMAC-SHA256 over `{timestamp}.{body}` with the channel's
secret). `verifyNotificationSignature` in `@deskbell/shared` is the
reference implementation a TypeScript receiver can import; the docs carry
the snippet for everyone else. Receivers should reject timestamps older than
five minutes.

**Outbound URL rules.** `validateWebhookUrl`: `https` only, `http` accepted
for `localhost` and `127.0.0.1`; no credentials in the URL; at most 2048
characters; literal loopback, link-local and private addresses refused.
Checked on save and again in the worker before every request. Requests carry
a 10 s timeout and do not follow redirects. Logs name the host, never the
URL.

**Extension contract.** A new event is one union member, one builder, one
Slack renderer case, one placeholder list and one docs row. A new channel is one file implementing
`NotificationChannel` and one entry in the settings schema and form.

## Non-goals

- A "send test" button; auto-disabling a channel after persistent failure
  (the status line makes it visible first).
- Email, Teams or a Slack app as channels; per-member personal notifications.
- Defending against DNS rebinding on the outbound request: hostnames are
  resolved by the runtime, and a self-hoster's internal receiver is a valid
  target.

## Open questions

- Whether the summary should default to `model` or `none` once real traffic
  shows how often the fallback is good enough.

## Verify

- Shared: schema defaults and rejections; link placeholder resolution and
  fallback; URL validation matrix; signature sign/verify round-trip and a
  tampered body.
- Worker: Slack rendering (escaping, eight context fields, truncation) and
  the webhook contract as a snapshot; the dispatcher against fake deps —
  both channels sent and usage recorded, one already delivered → only the
  other sent, vote withdrawn, budget spent → fallback summary still sent,
  model failure → fallback, `4xx` rejected and not retried, `5xx` rethrown
  after the successful channel is recorded.
- Web: the base-URL resolver; the settings page saves a URL, reloads with the
  input empty and the masked value shown (browser suite).
- Manual: a downvote in the dogfooded widget against a local receiver,
  exactly one delivery per channel for down→up→down, and the Block Kit
  rendering in a real Slack channel.
