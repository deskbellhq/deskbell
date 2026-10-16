# 2026-08-21 — Inbox and messenger UI: conversations inbox + widget polish

**Goal**: the product should read as a calm, modern support surface — white ground,
hairline borders, soft rounded bubbles, dense-but-airy panes. Two surfaces:

1. **Dashboard Conversations → split inbox.** Replace the table+separate-page flow with
   a three-pane inbox: conversation list pane (avatar, question, last-message
   snippet, relative time, refusal dot) · transcript thread · details panel (attributes +
   sources cited). List lives in the route **layout** so it persists across selection.
2. **Widget → Messenger look.** Same functionality, restyled: concierge-bell SVG launcher
   (chevron when open), header with title+subtitle, 16px-radius panel, soft rounded
   bubbles, pill citations, three-dot typing indicator, borderless composer with an
   icon send button.

Conventional patterns only. The three-pane inbox and the corner messenger are category
conventions; nothing here derives from any specific product's assets, copy, or trade
dress.

## Decisions

- **List in `conversations/layout.tsx`** (Server Component, force-dynamic): fetched once
  per navigation, persists across conversation switches. Staleness until reload is
  accepted (same as before; live updates stay a later analytics concern).
- **Responsive, mobile-first**: below `md` the list IS the index route and the
  thread replaces it when a conversation is open (client shell keyed on pathname);
  details panel shows only ≥ `xl`.
- **Roles**: visitor = left, gray bubble, colored initial avatar (deterministic hue from
  session id); agent = indented, soft blue bubble. Refusals stay first-class (outline
  badge on the bubble, dot in the list).
- **No fabricated data** rule carries over: details panel shows only persisted fields.
- **Widget budget unchanged**: restyle is CSS + inline SVGs; the 40KB gzip build gate
  still enforces AGENTS rule 5. Brandability preserved — everything keys off
  `--deskbell-accent`/`--deskbell-radius`/`--deskbell-font`.

## Out of scope

Overview/Sources restyle (already close to the target language), widget feedback
buttons, list search/filtering, assignee/teams concepts (we have no humans in the loop).
