# Publish the widget, the React wrapper, the SDK and the shared contracts

> Status: done · 2026-09-17

**Goal.** Today the only way to run the widget is `GET /deskbell.js` from a
Deskbell server. Nothing is installable: the four MIT packages point their
`exports` at TypeScript source, two of them have no build step, `@deskbell/shared`
is marked private (which would block publishing anything that depends on it),
and the changesets tool is installed but unconfigured. An application that
bundles its own JavaScript, wraps the widget in a branded element of its own, or
renders a custom UI on the SDK needs versioned packages on npm. This spec makes
the four MIT packages publishable with one version number between them.

## Design

**Names.** `packages/widget-core` publishes as **`@deskbell/widget`**; the
directory keeps its name so nothing in the repository moves. "core" is an
internal word, and `@deskbell/widget` pairs with `@deskbell/widget-react` and
`@deskbell/sdk`. The unscoped `deskbell` name stays reserved for a future CLI.
`@deskbell/widget-snippet` becomes private: the loader derives the API origin
from its own `script.src`, so a copy served from a CDN or an npm mirror would
call the wrong server. It is served by the app and only by the app.

**Build.** Workspace consumers keep importing TypeScript source (`exports` in
each `package.json` stay on `./src`), and `publishConfig.exports` points at
`dist` so only the published artifact changes shape. `@deskbell/widget` builds
with esbuild in ESM form, `preact` external and the two workspace dependencies
inlined, plus `tsc --emitDeclarationOnly` for types. `@deskbell/sdk`,
`@deskbell/shared` and `@deskbell/widget-react` build with `tsc`. `files` limits
every tarball to `dist` and `LICENSE`. The gzip gate stays on `deskbell.js`,
where the size is actually paid; the ESM build prints its size and gates nothing.

**Versioning.** Changesets, with the four packages in one fixed group so a
consumer pins one number, `access: public`, and every private package ignored by
construction. Releases run from a manually dispatched workflow until the npm
organisation exists; automatic publishing on `main` is a one-line change then.

**The wrapper's type boundary.** `@deskbell/widget-react` used a hand-written
`widget-core.d.ts` because the Preact source could not be type-checked from a
React program. With emitted declarations that shim goes away: the wrapper's
`paths` map the package name to `../widget-core/dist/index.d.ts`, which Turbo
builds first (`typecheck` depends on `^build`).

**Import extensions.** Node resolves a relative import in an ES module
exactly as written, so `./errors` in an emitted file fails outside a bundler;
0.1.0 shipped that way and `@deskbell/sdk` could not be imported from a Node
program. Relative imports in the four packages' sources carry their `.ts` or
`.tsx` extension, which `rewriteRelativeImportExtensions` turns into `.js` in
the emitted JavaScript and declaration files resolve as written. Biome's
`useImportExtensions` rule is an error for those four source trees, so an
extensionless import cannot come back. The `.js` spelling was tried first and
rejected: the web application imports the same sources through its bundler,
which does not map `.js` back to `.ts`, and its build broke.

## Non-goals

- Publishing `@deskbell/ui` (vendored dashboard components) or anything AGPL.
- A CDN build of the loader. See above: the loader is tied to its server.
- A UMD build. Every consumer this serves has a bundler or supports ESM.

## Open questions

- Whether `@deskbell/shared` should publish at all or be inlined into the SDK.
  Inlining would duplicate the zod schemas the server also uses; publishing keeps
  one copy. Published for now; revisit if the package surface grows.

## Verify

- `pnpm build` emits `packages/widget-core/dist/index.js` + `index.d.ts`, and
  `dist/` for sdk, shared and widget-react. Done: 14.5 KB gzip for the ESM
  widget with preact external.
- `pnpm pack` (never `npm pack`: only pnpm rewrites `workspace:*` ranges to
  versions and applies `publishConfig.exports`) in each of the four packages
  lists only `dist/**`, `LICENSE` and `package.json`. Done; the manifest inside
  the tarball carries `dist` exports and pinned sibling versions.
- A consumer outside the workspace installs the four tarballs plus preact and
  react, typechecks a file importing all four with `skipLibCheck` off, and
  bundles it with esbuild. Done: types resolve, the bundle contains the element
  and no zod.
- `deskbell.js` gzip size unchanged within half a kilobyte. Done: 16.5 to 16.6 KB.
- The packed `@deskbell/sdk` and `@deskbell/shared` import under plain Node
  (`node -e "import('@deskbell/sdk')"`) with no bundler, and a consumer file
  importing all four typechecks under `moduleResolution: nodenext` with
  `skipLibCheck` off. Done, 2026-10-16, after the 0.1.0 failure.
