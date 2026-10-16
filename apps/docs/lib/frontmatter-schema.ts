import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

/**
 * The frontmatter contract. `updated` is required, not optional: it tells a
 * reader whether the page has been checked since the code changed, and an
 * undated page cannot be audited. `sidebarTitle` is the short noun shown in
 * the sidebar when the page title is a sentence.
 *
 * The base schema strips unknown keys rather than rejecting them, so a field
 * that has been removed from the contract disappears silently instead of
 * failing the build. `frontmatter.test.ts` checks for the ones that must stay
 * gone.
 *
 * Kept in its own module, away from the macro that reads the content
 * directory, so tests can import it without a build step.
 */
export const frontmatterSchema = pageSchema.extend({
  sidebarTitle: z.string().min(1).optional(),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be YYYY-MM-DD"),
});
