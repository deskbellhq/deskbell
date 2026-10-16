# 2026-09-22 — Conversations inbox: default thread, one palette, the stored signal

Amends `2026-08-21-inbox-and-messenger-ui.md`. The three-pane inbox stays; what
changes is what it shows on arrival, which colours it uses, and how much of the
persisted answer signal an operator can read without opening the database.

## Problems

1. `/conversations` opened on an empty pane. Every visit cost one click before
   there was anything to read.
2. The thread page had colours of its own: a blue assistant bubble, an emerald
   thumbs-up, a weak-grounding icon that differed from the gaps page's, an
   uncertain dot with no dark-mode step, and an avatar pool that included the
   amber and rose the rest of the dashboard reserves for "uncertain" and
   "destructive". Two identical facts read differently on two pages.
3. The list titled a thread by its first question while the thread header used
   `conversations.title`; a renamed thread had two names. The list sorted by
   creation time while showing last-activity time.
4. The engine records why it refused, how many chunks it retrieved, the best
   score, latency and model per answer, and which gap cluster an answer belongs
   to (spec: answer-signal, gap-clusters). None of it was rendered; every
   refusal read "No grounded answer" whatever its reason.
5. Answers are Markdown in the widget (spec: answer-markdown) and were shown as
   raw text in the dashboard.
6. No filter, no limit on the list query, and no loading state on row clicks.

## Decisions

- **Newest thread opens by default, without a redirect.** The index page
  renders the newest matching thread in the desktop pane; the URL stays
  `/conversations`, and on phones the index is still the list. The first
  visible row is highlighted when no id is in the path.
- **One palette.** Tokens everywhere; colour is carried by icons in three
  signals only: amber (`500` light, `400` dark) for uncertain and weak,
  `destructive/80` for downvotes and failures, green (`500/400`) for certain
  and positive. The assistant bubble is a card with a hairline border; the
  visitor's bubble stays muted. The avatar pool contains no signal hue.
  A shared `FeedbackGlyph` renders thumbs in the table and the thread.
- **One list query** (`lib/conversations-list.ts`) shared by the layout and the
  index page: title falls back to the first question, ordering is last activity,
  the limit is 200. The filter (`all` · `uncertain` · `down`) is URL state
  read in the client shell, because a layout receives no search params; the
  index page evaluates the same predicate in SQL to pick the thread it opens.
- **Show the stored signal.** Refusal badge named by `refusalReason`; hits and
  best score in the badge tooltip; latency and model on the answer's footer
  line; "Open in Gaps" when the answer belongs to a cluster; a "Deleted by
  visitor" row when the visitor deleted the thread.
- **Markdown once.** The parser moves from `widget-core` to
  `@deskbell/shared/markdown` (MIT, dependency-free, inlined into the widget
  bundle like `widget-config`); the widget's Preact renderer and a new React
  renderer in the dashboard consume the same tree. Neither uses `innerHTML`.
- **Loading state**: `conversations/loading.tsx` renders a skeleton in the
  thread slot during navigation.

## Out of scope

Search, pagination beyond the limit, live refresh, keyboard navigation between
rows, editing or deleting threads from the dashboard, a project switcher.
