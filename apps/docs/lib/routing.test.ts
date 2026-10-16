import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docsPrefix, docsRoute, searchApiUrl, siteUrl } from "./shared";

/**
 * The site is served at deskbell.dev/docs through a rewrite from the
 * marketing deployment, and `basePath` is what makes this app agree with that.
 * Two things go wrong when it drifts, and both look fine in development:
 *
 *   1. Pages authored under an `app/docs/` directory would serve at
 *      `/docs/docs/…`, because `basePath` already supplies the prefix.
 *   2. The search dialog fetches from the browser, and a client fetch does not
 *      inherit `basePath`. An unprefixed URL returns nothing and is
 *      indistinguishable from a search that found no matches.
 *
 * These read the real config rather than trusting the constants to agree
 * with it.
 */

const nextConfig = readFileSync(join(import.meta.dirname, "../next.config.mjs"), "utf8");

describe("routing", () => {
  it("uses the same prefix in next.config.mjs and in shared.ts", () => {
    const match = nextConfig.match(/basePath:\s*"([^"]+)"/);

    expect(match, "no basePath in next.config.mjs").not.toBeNull();
    expect(match?.[1]).toBe(docsPrefix);
  });

  it("mounts pages at the app root so basePath is not applied twice", () => {
    // The loader's base URL is "/" and `basePath` prefixes it. Setting this to
    // "/docs" alongside basePath is what produces /docs/docs/<page>.
    expect(docsRoute).toBe("/");
  });

  it("prefixes the search endpoint", () => {
    expect(searchApiUrl.startsWith(`${docsPrefix}/`)).toBe(true);
    expect(searchApiUrl).toBe("/docs/api/search");
  });

  it("keeps canonical URLs on the marketing domain", () => {
    // This deployment also answers on its own Vercel domain. Without canonicals
    // pointing here, the two hosts compete for the same pages.
    expect(siteUrl).toBe("https://deskbell.dev");
    expect(siteUrl.endsWith("/")).toBe(false);
  });
});
