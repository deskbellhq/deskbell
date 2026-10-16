import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build, context } from "esbuild";

// Bundles the widget trilogy into a single IIFE served as /deskbell.js.
// The gzip gate mechanically enforces AGENTS rule 5 (≤40KB gzip).
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  jsxImportSource: "preact",
  outfile: "dist/deskbell.js",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  const gzipBytes = gzipSync(readFileSync("dist/deskbell.js")).length;
  console.log(`deskbell.js: ${(gzipBytes / 1024).toFixed(1)}KB gzip (budget 40KB)`);
  if (gzipBytes > 40_960) {
    console.error("Widget bundle exceeds the 40KB gzip budget (AGENTS rule 5)");
    process.exit(1);
  }
}
