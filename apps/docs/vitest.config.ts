import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * These tests guard three things that fail silently in a documentation site:
 * an edit link pointing at a path that does not exist, an option documented
 * with a blank description, and a search index that returns nothing.
 *
 * All three look identical to a working site until someone tries them, which
 * is why they are tests rather than something to remember to check.
 */
export default defineConfig({
  test: { include: ["lib/**/*.test.ts", "components/**/*.test.ts"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url).href.replace(/\/$/, "")) },
  },
});
