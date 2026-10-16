# Conversation retention

> Status: in progress · 2026-09-23

**Goal.** A project keeps every conversation until told otherwise. This spec
adds a retention window per project — a number of days, set under
**Settings › Data retention** — and a worker job that removes conversations
older than the window every hour. The `purge.conversations` queue has existed
as an empty registration since the scaffold and the schema has promised a
"retention window" since the conversations table was written; this is the
work both were waiting for.

## Design

### What a conversation's age is

A conversation is past the window when it started before the cutoff **and no
message in it was written at or after the cutoff**:

```sql
c.created_at < now() - days * interval '1 day'
and not exists (
  select 1 from messages m
  where m.conversation_id = c.id and m.created_at >= now() - days * interval '1 day'
)
```

This is the same definition of "latest activity" the inbox orders by
(`coalesce(max(messages.created_at), conversations.created_at)`) and the
widget's thread list uses. It is deliberately **not** `conversations.updated_at`:
the ask route never touches that column on a follow-up turn, while a rename, a
visitor's soft delete and the titling job all do — the opposite of activity. A
thread the visitor is still using never disappears under them; a thread nobody
has touched for the window's length goes, whether or not the visitor had
already hidden it from the widget.

Both halves of the predicate are served by indexes that already exist
(`conversations_project_created_idx`, `messages_conversation_idx`).

### One predicate, two readers

`packages/db/src/retention.ts` builds the predicate once and exposes a count and
a batched delete over it. The settings page shows the count; the worker runs the
delete. The number the confirmation dialog names is the number the job removes,
because they cannot be computed differently.

### What is removed

The `conversations` row, and through the existing `ON DELETE CASCADE`
constraints its `messages` and `action_calls`. That is the transcript, the
citations, the stored answer signal, the feedback, the host-page context and
every tool call — the personal data.

Left alone, on purpose:

- `end_users` — the visitor's profile row (name, email, subject). A separate
  concern with a separate policy; see Non-goals.
- `gap_clusters` and `gap_phrasings` — aggregated wordings, no session or
  visitor. A cluster whose member messages are all gone keeps its row, its
  analysis and its correction link; it drops out of the Gaps page for any
  period, because the page groups from message rows.
- `notification_deliveries` — ids and statuses used for de-duplication; inert
  once the message is gone.
- `token_usage` — numbers per day.

Consequence, accepted and documented: Overview counts, Gaps occurrences and
trend windows shrink as history is removed. Retention means losing history;
no snapshot table is kept.

### Storage

On `projects`:

| Column | Type | Meaning |
|---|---|---|
| `conversation_retention_days` | `integer not null default 0` | 0 keeps everything, like `daily_token_budget`'s 0. Bounds 1–3650 when set |
| `conversations_purged_at` | `timestamptz` | When the job last ran for this project, whatever it removed |
| `conversations_purged_count` | `integer not null default 0` | What that run removed |

A plain integer, not a jsonb document: the job needs the value in a `where`
clause, and the setting is one number. The status columns are written on every
run, including a run that removed nothing — "last run 12 minutes ago · 0
removed" is only worth showing if it is true — and never touch
`projects.updated_at`.

### The job

`purge.conversations`, scheduled hourly at minute 41 (its own queue and its own
cron, beside `maintenance.prune` at 17 and `gaps.catchup` at 23: a failure in
one must not read as a failure in another). For every project with a window,
oldest rows first, `delete … where id in (select … limit 1000)` until a batch
comes back short, **capped at 50 batches per project per run**. The worker is
serial, so a first purge over years of history must not hold ingestion and
notification delivery for its whole duration; the next hour continues where
this one stopped. The log line says so (`capped=true`).

Saving a window greater than zero also sends one job for that project
(singleton key `purge:<projectId>`), so the first removal does not wait for the
cron. The job accepts an optional `{ orgId, projectId }` and otherwise walks
every project; every query is org-scoped (D12).

Idempotent by construction: a removed row leaves the predicate. Throws
propagate and pg-boss retries; one project's failure is collected and re-thrown
after the others have run.

### The settings page

`/settings/retention`, in the Workspace group beside Members and Gaps (admin
and owner edit; everyone reads). A native `<select>` — **Keep forever · 30
days · 90 days · 180 days · 365 days · Custom…** — with a number input for
Custom. Under it, for the selected window, how many conversations are past it
right now; the presets' counts are computed in one query when the page renders,
Custom asks a server action. The status line reads from the two columns.

Saving a window that would remove conversations opens a confirmation naming
the count and what goes with them. Saving Keep forever, or a window nothing is
past, saves directly.

### Race

A visitor sending a turn to a conversation removed between the ask route's
lookup and its message insert gets one 500 from the foreign key. The widget
forgets a remembered id whose history fetch fails and starts a new thread.
Accepted; the window is measured in days and the batch in seconds.

## Non-goals

- An instance-wide default in the environment. One window per project, in the
  database, where the other project settings are.
- Rules per source, per visitor or per context key; legal holds; redaction of
  content in place; an export before removal; an audit row per run. These are
  the "advanced retention" line in `packages/ee/FEATURES`.
- Removing `end_users` rows. A visitor with no conversations left is still a
  known visitor until a separate policy says otherwise.
- Pruning empty gap clusters. They are the record of what was asked, not of
  who asked it.

## Open questions

- Whether creation time should be offered as an alternative rule for
  deployments whose policy is written that way. Not until someone asks.

## Verify

- Unit: the shared schema's bounds; the worker handler with fake dependencies
  (skips projects with no window, loops until a short batch, honours the cap,
  records every run, one failing project does not stop the rest).
- Browser: `settings-retention.spec.ts` — the seeded threads are 1–100 days
  old, so 30 days names three; the confirmation opens and can be declined; the
  value survives a reload; Keep forever saves without a dialog.
- Live: set 30 days on a seeded project, read the worker's
  `[purge.conversations]` line, confirm the inbox, Overview, Gaps and the
  widget's thread list no longer show the removed threads, and that a
  remembered id in the widget is forgotten without an error.
