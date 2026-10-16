import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { editUrl, gitConfig, repoIsPublic } from "./shared";

/**
 * Edit links are the one thing in a monorepo documentation site that breaks
 * silently. Every docs framework defaults to assuming the content directory is
 * at the repository root; here it is `apps/docs/content/docs`. A base missing
 * that prefix produces a link that 404s on every page, and nothing surfaces it
 * because maintainers do not click their own edit links.
 *
 * So rather than asserting the string looks right, these resolve the configured
 * path against the actual repository and check a real file is there.
 */

const repoRoot = resolve(import.meta.dirname, "../../..");
const contentRoot = join(repoRoot, gitConfig.contentDir);

describe("edit links", () => {
  it("points at a content directory that exists in this repository", () => {
    expect(existsSync(contentRoot)).toBe(true);
  });

  it("resolves to real files, not just a real directory", () => {
    const entries = readdirSync(contentRoot).filter((name) => name.endsWith(".mdx"));

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(existsSync(join(contentRoot, entry))).toBe(true);
    }
  });

  it("carries the full monorepo path, not a repository-root default", () => {
    expect(gitConfig.contentDir).toBe("apps/docs/content/docs");
    // The two shapes that silently 404: a bare `docs/` prefix, or the content
    // path without the app that contains it.
    expect(gitConfig.contentDir).not.toBe("docs");
    expect(gitConfig.contentDir).not.toBe("content/docs");
  });

  it("builds a URL under blob/<branch>/<contentDir> when the repository is public", () => {
    // repoHref() returns null before launch, which renders as no link rather
    // than a broken one. Only the public shape is worth asserting.
    if (!repoIsPublic) {
      expect(editUrl("quickstart.mdx")).toBeNull();
      return;
    }

    expect(editUrl("quickstart.mdx")).toBe(
      `https://github.com/${gitConfig.user}/${gitConfig.repo}` +
        `/blob/${gitConfig.branch}/apps/docs/content/docs/quickstart.mdx`,
    );
  });
});
