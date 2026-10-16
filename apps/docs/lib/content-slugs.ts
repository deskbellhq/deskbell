import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSlugs } from "fumadocs-core/source";

/**
 * The content directory as the loader sees it, for tests that need the set of
 * live slugs without a build: the link checker, the redirect table, the page
 * tree. `getSlugs` is the loader's own rule, so `deploy/index.mdx` maps to
 * `/deploy` here exactly as it does on the site.
 */
export const contentRoot = join(import.meta.dirname, "../content/docs");

export function pageFiles(dir: string = contentRoot): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name.endsWith(".mdx") || name.endsWith(".md") ? [path] : [];
  });
}

/** Path relative to the content root, e.g. `deploy/models.mdx`. */
export function relativePath(path: string): string {
  return path.slice(contentRoot.length + 1);
}

/** `deploy/models.mdx` -> `/deploy/models`, `index.mdx` -> `/`. */
export function slugOf(path: string): string {
  return `/${getSlugs(relativePath(path)).join("/")}`;
}

export function liveSlugs(): Set<string> {
  return new Set(pageFiles().map(slugOf));
}

/** The raw frontmatter block as key/value strings, no YAML parser needed. */
export function frontmatterOf(source: string): Record<string, string> {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const key = line.slice(0, line.indexOf(":")).trim();
    const value = line.slice(line.indexOf(":") + 1).trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}

export function bodyOf(source: string): string {
  return source.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export function readPage(path: string): {
  path: string;
  fields: Record<string, string>;
  body: string;
} {
  const source = readFileSync(path, "utf8");
  return { path: relativePath(path), fields: frontmatterOf(source), body: bodyOf(source) };
}
