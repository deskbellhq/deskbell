import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/**
 * Serves the built widget bundle at /deskbell.js — the URL customers' script
 * tags load. The artifact is built by @deskbell/widget-snippet (turbo `dev`
 * and `build` order it before this app via ^build).
 */
export async function GET() {
  try {
    // Anchor at cwd (apps/web), not import.meta.url — bundlers rewrite the
    // latter into virtual URLs that createRequire can't use.
    const require = createRequire(join(process.cwd(), "package.json"));
    const bundlePath = require.resolve("@deskbell/widget-snippet/deskbell.js");
    const js = await readFile(bundlePath);
    return new Response(new Uint8Array(js), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": process.env.NODE_ENV === "production" ? "public, max-age=300" : "no-store",
      },
    });
  } catch {
    return new Response(
      '// Deskbell widget bundle missing — run "pnpm --filter @deskbell/widget-snippet build"\n',
      { status: 503, headers: { "content-type": "text/javascript; charset=utf-8" } },
    );
  }
}
