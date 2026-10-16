import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the request-time policy in lib/ — the abuse guard's decisions
 * (spec: widget-abuse-protection). The alias mirrors tsconfig's `@/*` so a test
 * imports exactly what the route does.
 *
 * These cover pure functions only; the SQL and the pages are exercised against
 * a real Postgres by the browser suite in e2e/ (`pnpm e2e`, spec:
 * dashboard-browser-tests), which vitest must not pick up.
 */
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"], exclude: ["e2e/**", "node_modules/**"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url).href.replace(/\/$/, "")) },
  },
});
