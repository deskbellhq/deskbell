import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { metaSchema } from "fumadocs-core/source/schema";
import { describe, expect, it } from "vitest";
import { contentRoot, pageFiles } from "./content-slugs";

/**
 * The page-tree builder is forgiving in ways that hide mistakes: a `meta.json`
 * key it does not know is stripped, an entry that resolves to nothing is
 * dropped, and a page no `meta.json` mentions still renders but falls out of
 * the sidebar and llms.txt. This pins the structure instead:
 *
 *   - sections are folders extracted into the root list under a header
 *   - each section opens with its index page and closes with faq or
 *     troubleshooting when it has one
 *   - every content page is listed exactly once
 */

const SEPARATOR = /^---(?:\[[^\]]+\])?.+---$|^---$/;
const EXTRACT = /^\.\.\.(.+)$/;
const CLOSERS = new Set(["faq", "troubleshooting"]);

function metaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return metaFiles(path);
    return name === "meta.json" ? [path] : [];
  });
}

function readMeta(path: string): { dir: string; pages: string[] } {
  const parsed = metaSchema.strict().safeParse(JSON.parse(readFileSync(path, "utf8")));
  expect(parsed.success, `${relative(contentRoot, path)}: ${parsed.error?.message}`).toBe(true);
  return { dir: join(path, ".."), pages: parsed.data?.pages ?? [] };
}

function resolves(dir: string, entry: string): boolean {
  return (
    existsSync(join(dir, `${entry}.mdx`)) ||
    existsSync(join(dir, `${entry}.md`)) ||
    (existsSync(join(dir, entry)) && statSync(join(dir, entry)).isDirectory())
  );
}

const metas = metaFiles(contentRoot).map(readMeta);
const root = metas.find((meta) => meta.dir === contentRoot);

describe("page tree", () => {
  it("has a root meta", () => {
    expect(root).toBeDefined();
  });

  it("lists only entries that exist", () => {
    for (const meta of metas) {
      for (const entry of meta.pages) {
        if (SEPARATOR.test(entry)) continue;
        const extracted = entry.match(EXTRACT);
        const name = extracted ? (extracted[1] as string) : entry;
        expect(resolves(meta.dir, name), `${relative(contentRoot, meta.dir)}: ${entry}`).toBe(true);
      }
    }
  });

  it("opens every section with its overview", () => {
    const pages = root?.pages ?? [];
    for (const [i, entry] of pages.entries()) {
      if (!SEPARATOR.test(entry)) continue;
      const next = pages[i + 1];
      expect(next, `${entry} is followed by nothing`).toBeDefined();
      const extracted = next?.match(EXTRACT);
      if (extracted) {
        const folder = metas.find((meta) => meta.dir === join(contentRoot, extracted[1] as string));
        expect(folder?.pages[0], `${entry}: ${next} must list index first`).toBe("index");
      } else {
        expect(next, `${entry} must be followed by an overview page`).toBe("index");
      }
    }
  });

  it("closes a section with its faq or troubleshooting page", () => {
    for (const meta of metas) {
      const closers = meta.pages.filter((entry) => CLOSERS.has(entry));
      for (const closer of closers) {
        expect(meta.pages.at(-1), `${relative(contentRoot, meta.dir)}: ${closer} is not last`).toBe(
          closer,
        );
      }
    }
  });

  it("lists every page exactly once", () => {
    const listed = new Map<string, number>();
    for (const meta of metas) {
      for (const entry of meta.pages) {
        if (SEPARATOR.test(entry) || EXTRACT.test(entry)) continue;
        const file = [`${entry}.mdx`, `${entry}.md`]
          .map((name) => join(meta.dir, name))
          .find((path) => existsSync(path));
        if (file) listed.set(file, (listed.get(file) ?? 0) + 1);
      }
    }

    for (const path of pageFiles()) {
      const rel = relative(contentRoot, path);
      // A folder's own index page is the folder header, never a list entry,
      // unless the folder is extracted into its parent.
      const isFolderPage = /(^|\/)index\.mdx?$/.test(rel) && rel.includes("/");
      const folderMeta = metas.find((meta) => meta.dir === join(path, ".."));
      const extractedIntoParent = metas.some((meta) =>
        meta.pages.includes(`...${relative(meta.dir, join(path, ".."))}`),
      );
      if (isFolderPage && !extractedIntoParent) {
        expect(folderMeta?.pages.includes("index"), `${rel}: a folder page is not listed`).toBe(
          false,
        );
        continue;
      }
      expect(listed.get(path) ?? 0, `${rel} must be listed exactly once`).toBe(1);
    }
  });
});
