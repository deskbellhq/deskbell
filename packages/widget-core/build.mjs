import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

// The npm build of @deskbell/widget: one ES module with the workspace
// dependencies inlined and preact left to the consumer's bundler. The 40KB
// gzip gate (AGENTS rule 5) lives on deskbell.js in widget-snippet, where the
// weight is actually paid on a page; this build only reports its size.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  jsxImportSource: "preact",
  external: ["preact", "preact/*"],
  outfile: "dist/index.js",
  sourcemap: true,
  logLevel: "info",
});

const gzipBytes = gzipSync(readFileSync("dist/index.js")).length;
console.log(
  `@deskbell/widget: ${(gzipBytes / 1024).toFixed(1)}KB gzip (unminified, preact external)`,
);
