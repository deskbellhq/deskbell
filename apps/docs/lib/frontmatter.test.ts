import { describe, expect, it } from "vitest";
import { pageFiles, readPage } from "./content-slugs";
import { frontmatterSchema } from "./frontmatter-schema";

/**
 * The frontmatter schema runs at build time, so presence and format are already
 * guaranteed. What it cannot check is whether a page is honest about itself:
 *
 *   - `updated` in the future means someone typed a date rather than read one.
 *   - A description that repeats the title tells a reader nothing, and answer
 *     engines extract descriptions as standalone passages.
 *   - The schema strips keys it does not know, so a field removed from the
 *     contract would keep working silently. `status` was removed on purpose.
 *   - A page describes what the software does. Words that describe how
 *     finished it is have no place on the site.
 */

const pages = pageFiles().map(readPage);

/**
 * Maturity vocabulary. Limits are documented as facts under a Limits or Scope
 * heading, not as things that are missing.
 */
const MATURITY =
  /pre-alpha|\balpha\b|\bbeta\b|not (?:yet )?built|not yet|coming soon|experimental/i;

describe("frontmatter", () => {
  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("satisfies the schema the build enforces", () => {
    for (const page of pages) {
      const result = frontmatterSchema.safeParse(page.fields);
      expect(result.success, `${page.path}: ${result.error?.message}`).toBe(true);
    }
  });

  it("is not dated in the future", () => {
    const today = new Date().toISOString().slice(0, 10);

    for (const page of pages) {
      expect(page.fields.updated?.localeCompare(today), `${page.path} is dated ahead`).toBeLessThan(
        1,
      );
    }
  });

  it("describes the page rather than restating the title", () => {
    for (const page of pages) {
      const description = page.fields.description ?? "";
      expect(description.length, `${page.path}: description too short`).toBeGreaterThan(40);
      expect(description, `${page.path}: description is the title`).not.toBe(page.fields.title);
    }
  });

  it("carries no status field", () => {
    for (const page of pages) {
      expect("status" in page.fields, `${page.path} still has a status field`).toBe(false);
    }
  });

  it("describes what runs, not how finished it is", () => {
    for (const page of pages) {
      const hit = page.body.match(MATURITY);
      expect(hit, `${page.path}: "${hit?.[0]}"`).toBeNull();
    }
  });
});
