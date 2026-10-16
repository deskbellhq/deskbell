# 2026-08-21 — UI foundation: shadcn/ui + Tailwind v4

**Decision (D11 addendum — see `.ai/decisions/D11-tech-stack.md`)**: the dashboard UI is built
with **Tailwind CSS v4** and **shadcn/ui** (new-york style, Radix primitives, zinc base,
CSS-variable theming). Components are vendored source in `packages/ui` (MIT — shadcn code is
MIT, license-compatible), added via the shadcn CLI monorepo flow.

## Scope

- `packages/ui` owns the design system: `src/styles/globals.css` (Tailwind entry + theme
  tokens), `src/lib/utils.ts` (`cn()`), `src/components/*` (shadcn components), own
  `components.json`.
- `apps/web` consumes it: imports `@deskbell/ui/globals.css` in the root layout, PostCSS
  config with `@tailwindcss/postcss`, own `components.json` whose `ui`/`utils` aliases point
  at `@deskbell/ui`. Geist Sans/Mono via `next/font` (literal family names in `@theme inline`
  — runtime CSS vars don't resolve there).
- Starter component set: the admin-dashboard staples (button, card, table, tabs, dialog,
  alert-dialog, dropdown-menu, sheet, sidebar, form inputs, badge, avatar, skeleton, tooltip,
  sonner, command, …). More are pulled on demand with
  `pnpm dlx shadcn@latest add <name>` from `apps/web`.

## Hard boundaries

- **The widget trilogy never uses Tailwind or shadcn.** `widget-core` stays Preact +
  shadow-DOM scoped CSS with custom-property theming (≤40KB gzip budget, zero deps beyond
  preact). `packages/ui` is dashboard-only.
- `packages/ui` stays MIT and imports no AGPL package (existing license rule).
- Dark mode tokens ship now (`.dark` class + `@custom-variant`); the theme toggle
  (next-themes) lands with spec: dashboard-shell.

## Non-goals

- No dashboard screens — spec: dashboard-shell builds the actual shell on this foundation.
- No custom design language yet; stock zinc theme until branding work.
