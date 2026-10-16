# @deskbell/widget (directory `packages/widget-core`)

The embeddable widget. MIT — ships on customers' pages, from `deskbell.js` and
from npm as `@deskbell/widget`.

Rules:
- Bundle budget ≤ 40KB gzip, measured on `deskbell.js`. No third-party code beyond
  preact. The two workspace packages inlined at build time, `@deskbell/shared/widget-config`
  and `@deskbell/sdk`, are dependency-free by their own rules; every other import is
  scrutinized.
- All server communication goes through `@deskbell/sdk`. No `fetch` in this package
  (spec: sdk-client); a new endpoint gets an SDK method first.
- Shadow DOM always; styles never leak in or out.
- The customization surface has four layers and is generated from one descriptor
  (`@deskbell/shared/widget-config`): attributes → `--deskbell-*` tokens → `::part()` →
  named slots. Reference: `docs/widget-customization.md` — regenerate with
  `pnpm docs:widget` after touching the descriptor; CI checks it is current.
- Never hardcode a colour, radius or size in `src/styles.ts`. Add a token to `TOKENS`,
  give it a palette default in the light AND dark blocks, and read it three deep:
  `var(--deskbell-x, var(--_cfg-x, var(--_pal-x)))`. A colour defined only inside the
  dark media query leaves light mode blank.
- Adding a structural element? Give it a `part=` and declare it in `PARTS`. A part in
  the docs that no element carries is a broken public API — there is a test for it.
- Never import AGPL packages (`core`, `db`, `connectors`, `evals`).
- Accessibility is not optional: focus trap in the panel, aria labels, keyboard close.
- Behaviour gets a DOM test: `src/*.dom.test.tsx` renders the real panel under happy-dom
  against a fake SDK client (see `panel.dom.test.tsx`); pure modules keep node tests.
  The browser suite in `apps/web/e2e/widget/` covers the served bundle on a foreign origin.
- No third-party network calls — the widget talks to the customer's Deskbell server, nothing else.
