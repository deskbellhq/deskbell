import { describe, expect, it } from "vitest";
import { liveSlugs, pageFiles, readPage } from "./content-slugs";
import { docsPrefix } from "./shared";

/**
 * Internal links are written against the loader's base URL ("/quickstart"), not
 * the served path ("/docs/quickstart"), because Next applies `basePath` on its
 * own. Both mistakes are easy and neither fails the build:
 *
 *   - a link to a page that does not exist renders and 404s on click
 *   - a link that includes the prefix itself resolves to /docs/docs/…
 *
 * Fumadocs 16 ships no link validator, so this is it. Redirects do not rescue
 * a stale link: the target must be a page that exists.
 */

const slugs = liveSlugs();

const links = pageFiles().flatMap((path) => {
  const page = readPage(path);
  return (
    [...page.body.matchAll(/\]\((\/[^)\s]*)\)/g)]
      .map((match) => ({ file: page.path, href: match[1] as string }))
      // Files under public/ (images, the OpenAPI document) are not pages.
      .filter((link) => !/\.(png|jpe?g|gif|svg|webp|json)$/i.test(link.href))
  );
});

describe("internal links", () => {
  it("finds links to check", () => {
    expect(links.length).toBeGreaterThan(0);
  });

  it("points at pages that exist", () => {
    for (const link of links) {
      // Anchors are not resolved here; the page they hang off is.
      const target = link.href.split("#")[0] || "/";
      expect(slugs.has(target), `${link.file}: no page at ${target}`).toBe(true);
    }
  });

  it("does not include the basePath prefix", () => {
    for (const link of links) {
      expect(
        link.href.startsWith(`${docsPrefix}/`),
        `${link.file}: ${link.href} already has the ${docsPrefix} prefix, which Next adds`,
      ).toBe(false);
    }
  });
});
