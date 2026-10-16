# 2026-08-21 — Widget customization: tokens, parts, slots, dashboard editor

**Goal**: make the widget genuinely brandable — the "brandable widget" v1 promise in
v1 scope (ROADMAP.md) — by a non-technical admin from the dashboard, by a developer from the embed
code, and by a designer with nothing but CSS. Today the entire surface is three
attributes (`project-key`, `api-url`, `locale`) and four CSS custom properties.

This spec **subsumes the unwritten `widget-js-api` spec**: a custom launcher is useless
without a way to open the widget, so the command queue and the imperative API ship here.

## Reference

The prevailing pattern in embeddable widgets is a large flat surface of `data-*`
attributes: behavioural params, a colour palette with `-dark` variants, and 40+
components styled as `data-{component}-{state}-{property}` (e.g.
`data-launcher-button-hover-background-color`). Surveyed 2026-08-21.

That model is CSS re-encoded as untyped HTML strings: unbounded, unvalidatable, and it
multiplies with every new component. We reject it. The platform already ships two
mechanisms that do the same job better and cost us almost nothing — **CSS custom
properties** pierce the shadow boundary for theming, and **`::part()`** exposes structural
elements for layout. Both are real CSS, so media queries, `:hover`, autocomplete and the
host page's own design system work for free.

Our surface: **21 options, ~30 tokens, ~20 parts, 4 slots.**

## Decisions

- **Four layers, each an escape hatch for the one below.** L1 dashboard editor (live
  preview + snippet generator) → L2 embed attributes / JS config → L3 tokens + `::part()`
  → L4 named slots. Headless React (`useDeskbell`) is explicitly out of scope.
- **Precedence**: defaults < server config < embed attributes / JS config < host-page CSS.
  Host CSS wins last on purpose — `deskbell-widget { --deskbell-accent: red }` is the most
  explicit statement of intent on the page, and nothing resolved at runtime should beat it.
- **Mechanism, no specificity war**: every rule reads three deep,
  `var(--deskbell-accent, var(--_cfg-accent, var(--_pal-accent)))`. `--_pal-*` is the
  palette default (swapped by colour scheme), `--_cfg-*` is written by JS into a generated
  `<style>` in the shadow root, `--deskbell-*` is whatever the host page set. No
  `!important`, no inline styles on the host element.
- **Single source of truth**: one zod-free descriptor in
  `@deskbell/shared/widget-config` defines every option once. The zod schema (server
  validation), TS types, widget-side coercion, dashboard form controls and the docs table
  all derive from it. Adding an option means editing one file.
  - Rule tension, recorded deliberately: AGENTS rule 5 says `widget-core` has "zero
    dependencies beyond preact". `@deskbell/shared` moves to its `dependencies` for the
    `./widget-config` subpath only. It is workspace-internal, imports nothing, and esbuild
    inlines it — the intent of the rule (no third-party code, no bundle bloat) holds. zod
    stays behind the `"."` entry point and never enters the bundle.
- **Dark mode** is a three-block palette on an internal `.root[data-scheme]` wrapper:
  light, dark, and `auto` (light values first, then `@media (prefers-color-scheme: dark)`).
  No colour may be defined only inside the media block.
- **Backward compatibility is binding**: `--deskbell-accent`, `--deskbell-radius`,
  `--deskbell-font` and `--deskbell-z` keep working forever — they are the canonical names
  in the new token set. `apps/web/app/(dashboard)/layout.tsx` depends on two of them. A test
  pins this.
- **Server config** lives in a new `projects.appearance` jsonb column, read through the
  existing org-scoped project lookup (no new tenancy surface, D12 unchanged), served from
  `GET /api/v1/config?key=pk_...` with a 60s cache. The widget defers first paint until
  config settles, with a hard ~1200ms timeout falling back to defaults — a sub-200ms delay
  on a 48px corner launcher is invisible, and it beats repainting the brand colour in front
  of the visitor.
- **White-label** (`poweredBy`) is decided server-side so the MIT/AGPL boundary stays
  clean: the widget renders what it is told. It is a licence term, not DRM — the widget is
  MIT and anyone can delete the badge from source. One-line gate, documented honestly, no
  enforcement theatre.
- **Copy** becomes overridable per string. `REASONS` currently derives from `COPY` at
  module scope and must move inside the component.

## Security

`GET /api/v1/config` is the fourth public unauthenticated endpoint. It is a cached DB read
with no LLM spend, so the abuse profile is mild, but it inherits the fail-open CORS in
`apps/web/lib/widget-cors.ts` (`*` when `allowedOrigins` is empty). **spec:
widget-abuse-protection remains LAUNCH-BLOCKING and should land before or alongside this
spec's phase 4.**

## Out of scope

Headless React hooks; iframe mode (spec: widget-iframe-mode); a full i18n message catalog
beyond per-string overrides; theme presets/marketplace; per-component style attributes.

## Open design question (added 2026-08-24)

**Two-pane layout.** Can a customer put the conversation list
permanently beside the thread, Slack-style. They cannot, at any amount of CSS:
`packages/widget-core/src/panel.tsx` holds a single `view: "thread" | "list"` state and
renders one or the other through a ternary, so the markup for both never coexists. This
is documented in `docs/widget-customization.md` under "What CSS cannot do" so people stop
trying.

Whether it *should* be reachable is a genuine design question, not a bug, and it is
non-trivial: two panes need a second scroll container, a responsive collapse below the
panel's width, focus management across panes, and a decision about whether the list stays
mounted (state, or refetch on every switch). It is not a `::part()` away.

Deferred, not rejected. Revisit if operators ask for it — a docs widget and an
inbox-shaped support widget want different answers, and D5 (overlay, never a helpdesk)
should be weighed before building the second one. No public home for the discussion yet:
GitHub Discussions are disabled on `deskbellhq/deskbell` until the repo goes public.
