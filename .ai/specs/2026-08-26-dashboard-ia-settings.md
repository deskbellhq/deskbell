# dashboard-ia-settings

> Status: shipped · 2026-08-26
> Reorganizes the dashboard's information architecture: product surfaces stay in the main
> sidebar, configuration moves to a dedicated `/settings` area with its own grouped
> sub-navigation. Also removes the sidebar's dead links, adds the missing account page,
> a shared page header, a command palette, and a dismissible GitHub star card.

## Problem

The dashboard shell has drifted from what it presents. The sidebar carries four dead `#`
entries (Settings, Documentation, Gaps, Top questions) — two for pages that were never
built and two for surfaces that exist but have no route. No sidebar item ever shows an
active state, so the only orientation cue is the page content itself. Every page hand-rolls
its own title/description block (the same three-line pattern appears ~10 times), the
user-menu "Account" item does nothing, and configuration pages (Appearance, Deploy,
Members) sit beside product surfaces (Overview, Sources, Conversations) as one undivided
list even though they serve different jobs: one set is visited daily, the other during
setup and administration.

## Decisions

1. **Configuration lives under `/settings`, in its own shell.** A conventional grouped
   settings layout: a narrow sub-sidebar with labeled groups, a "Back to app" link, and a
   left-aligned, width-capped content column — left-aligned rather than viewport-centered
   because the appearance page's live widget preview owns the bottom-right corner and a
   centered column runs underneath it. Groups: **Account** → Account (new) · **Workspace** → Members
   (moved from `/members`) · **Widget** → Appearance (moved from `/appearance`), Deploy
   (moved from `/deploy`). App Router layouts compose rather than replace, so `/settings`
   is a sibling top-level segment of `(dashboard)` inheriting only the root layout — that
   is what lets it swap the whole shell.
2. **The settings shell embeds the widget too.** The appearance editor drives its live
   preview through the `deskbell-widget` element on the page; a settings shell without the
   embed silently breaks the preview. The script + element block is extracted into a shared
   `WidgetEmbed` used by both shells.
3. **Old URLs redirect, temporarily.** `next.config.ts` sends `/members`, `/appearance`,
   `/deploy` (and bare `/settings`) to their new homes with `permanent: false` — 308s are
   cached too aggressively for a pre-1.0 IA that may shuffle again. Redirects run before
   the proxy, so the moved segments leave the auth matcher and `/settings/:path*` joins it.
4. **Account page: display name only.** Edit name (better-auth `updateUser`), show email
   read-only, sign out. Password and email changes are separate features with their own
   flows (see password-reset-email spec) and stay out.
5. **Members stays admin-gated exactly as before.** The settings sidebar hides the
   Workspace group below admin, the page still redirects (now to `/settings/account`, so
   the user stays in the shell they were in), and the server actions remain the real fence.
6. **Dead links are removed, not disabled.** Gaps and Top questions leave the nav until
   the pages exist (a nav that promises nothing it can't deliver). Documentation points at
   the public docs site — the deploy page already deep-links it; the URL moves to a shared
   `lib/links.ts` constant beside the GitHub URL.
7. **One `PageHeader` component** (title, optional description, optional actions slot)
   replaces the hand-rolled blocks on Overview, Sources, Appearance, Deploy, Members and
   Account. The conversations inbox keeps only the slim top bar: it is a height-locked
   split pane where a large in-pane title costs list rows.
8. **Command palette (⌘K/Ctrl-K)** over the already-vendored cmdk dialog: navigation to
   every page the current role can reach, "Ask a question" (dispatches `deskbell:open`),
   and Documentation. Mounted in both shells.
9. **Dismissible "Star Deskbell on GitHub" card** above the main sidebar's footer group.
   Star count is fetched server-side (hourly revalidate, 3s timeout) and passed into the
   client sidebar as a rendered node behind `Suspense`, so a slow or failed GitHub call can
   never block dashboard paint and the count simply doesn't render while the repository is
   private or the instance is air-gapped. Dismissal persists in `localStorage` — a promo
   card does not justify a schema migration, and per-browser scope is acceptable.
10. **Active navigation state everywhere.** All sidebar items derive `isActive` from
    `usePathname()` (exact match for `/`, prefix match otherwise) and use `next/link` for
    client-side navigation; external links open in a new tab.

## Out of scope

- Dark-mode toggle (tokens exist; provider and toggle are a separate decision).
- Password or email change on the account page.
- Gaps / Top questions analytics pages (removed from nav until built).
- Any change to the widget surface, `/api/v1/*`, or auth flows.

## Verification (2026-08-26, production standalone build + scratch database)

- Static: Biome clean, `next typegen` + typecheck (15 projects), 84 web tests, full build — green.
- Old URLs 307 to their settings homes signed-out and signed-in; bare `/settings` lands on
  `/settings/account`; moved segments are out of the proxy matcher and `/settings/:path*` is in.
- Both shells: active states track the pathname (including nested conversation paths),
  navigation is client-side, no `#` links remain, "Back to app" returns to Overview.
- Appearance live preview opens on arrival and updates while typing after the move — the
  shared widget embed in the settings shell is what makes that work.
- Members post-move: invite → pending table → copyable link → accept as viewer, all working.
- Viewer fencing: no Workspace group, no Members palette entry, `/settings/members`
  redirects to `/settings/account`.
- Account: rename persists (the users-table read is what survives the session cookie
  cache — a save used to render the old name back), email read-only, log out lands on
  `/login`.
- Palette: ⌘K opens in both shells, navigates, and "Ask a question" opens the widget.
- Star card: renders without a count while the repository API 404s, dismissal writes
  localStorage and survives reload.
- Onboarding checklist's "Open Deploy" lands on `/settings/deploy`.
