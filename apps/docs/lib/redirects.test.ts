import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redirects } from "../redirects.mjs";
import { contentRoot, liveSlugs } from "./content-slugs";

/**
 * Redirects run before routing, so a source that is also a live page shadows
 * the page: the redirect wins and the page can never be reached. The reverse
 * failure is a destination that does not exist, which turns an old bookmark
 * into a 404 with an extra hop. Neither fails the build.
 */

const slugs = liveSlugs();
const sources = new Set(redirects.map((entry) => entry.source));
const external = (path: string) => path.startsWith("https://");

describe("redirects", () => {
  it("has entries to check", () => {
    expect(redirects.length).toBeGreaterThan(0);
  });

  it("are written without the basePath", () => {
    for (const entry of redirects) {
      for (const path of [entry.source, entry.destination]) {
        if (external(path)) continue;
        expect(path.startsWith("/"), `${path} must start with /`).toBe(true);
        expect(path.startsWith("/docs/"), `${path} carries the basePath, which Next adds`).toBe(
          false,
        );
      }
    }
  });

  it("never shadows a live page", () => {
    for (const entry of redirects) {
      if (entry.source.includes(":")) continue;
      expect(slugs.has(entry.source), `${entry.source} is a live page`).toBe(false);
    }
  });

  it("lands on a page that exists", () => {
    for (const entry of redirects) {
      if (external(entry.destination)) continue;
      const target = entry.destination.split("#")[0] as string;
      if (target.includes(":")) {
        const folder = join(contentRoot, target.slice(1, target.indexOf(":")));
        expect(existsSync(folder) && statSync(folder).isDirectory(), `${folder} missing`).toBe(
          true,
        );
        continue;
      }
      expect(slugs.has(target), `${entry.source} -> ${target}: no page there`).toBe(true);
    }
  });

  it("does not chain", () => {
    for (const entry of redirects) {
      expect(sources.has(entry.destination), `${entry.destination} is itself redirected`).toBe(
        false,
      );
    }
  });
});
