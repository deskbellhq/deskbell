<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Local gotchas (outside the generated block above)

Both cost real debugging time; neither fails in a way that points at the cause.

- **After a migration, restart the dev server.** `lib/db.ts` caches the Drizzle
  instance on `globalThis` so it survives HMR — which means the running server
  keeps a client built from the *old* schema. A column you just added reads back
  as `undefined` rather than erroring, so it looks like a query bug. Next also
  refuses a second dev server for the same directory, so you cannot sidestep it.
- **After moving or renaming a route directory, regenerate the route types.**
  `tsconfig.json` includes `.next/types/**/*.ts`, so a stale build artifact can
  fail `tsc --noEmit`: the generated validator still holds
  `import("../../app/<old-dir>/route.js")` for a directory that no longer exists.
  The error therefore names the path you *removed*, from inside
  `.next/types/validator.ts` — not the route you added — so it reads as if the
  move broke something when only the artifact is behind. `next dev`, `next build`
  and `next typegen` all regenerate it; `typegen` is the cheapest when you only
  need types. Regenerate, never revert the move.
