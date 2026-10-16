import { describe, expect, it } from "vitest";
import { absoluteFromUrl, docsPrefix, siteUrl } from "./shared";

/**
 * Machine-readable output has to carry absolute URLs.
 *
 * Next prefixes rendered links with `basePath`, so page code can write "/x" and
 * get "/docs/x". Nothing does that for text written into a file. Left relative,
 * a link in llms.txt sends an agent to deskbell.dev/quickstart, which is the
 * marketing site, and the agent reports the documentation as missing rather
 * than as wrong.
 */
describe("absolute URLs for agents", () => {
  it("prefixes a page URL with the site and the docs path", () => {
    expect(absoluteFromUrl("/quickstart")).toBe(`${siteUrl}${docsPrefix}/quickstart`);
    expect(absoluteFromUrl("/widget/install")).toBe(`${siteUrl}${docsPrefix}/widget/install`);
  });

  it("handles the index page without a trailing slash", () => {
    expect(absoluteFromUrl("/")).toBe(`${siteUrl}${docsPrefix}`);
  });

  it("never produces a link that misses the docs path", () => {
    for (const url of ["/", "/quickstart", "/self-hosting/models"]) {
      const absolute = absoluteFromUrl(url);
      expect(absolute.startsWith(`${siteUrl}${docsPrefix}`)).toBe(true);
      expect(absolute).not.toContain(`${docsPrefix}${docsPrefix}`);
    }
  });
});
