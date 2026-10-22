/**
 * The path prefixes a crawl is limited to, from one form field: separated by
 * commas, whitespace or newlines, each made to start with a slash. A prefix
 * given as a full URL keeps only its path, since pasting the section's
 * address is the natural thing to do. Empty means the whole site.
 */
export function parseIncludePaths(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    let path = piece.trim();
    if (!path) continue;
    if (/^https?:\/\//i.test(path)) {
      try {
        path = new URL(path).pathname;
      } catch {
        continue;
      }
    }
    if (!path.startsWith("/")) path = `/${path}`;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}
