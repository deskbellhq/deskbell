import { load } from "cheerio";

/**
 * Readability-lite main-content extraction. Output is heading-aware
 * pseudo-markdown ("#"-prefixed heading lines, blank-line-separated blocks)
 * so the core chunker can split on structure. Content is emitted as-is —
 * instruction-like content is NOT cleaned here (flagging lands with
 * spec: ingestion-pipeline follow-up; see AGENTS.md).
 */

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
].join(",");

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,td,th,blockquote";
/** Containers skipped when they hold block children (children are selected on their own). */
const CONTAINERISH = new Set(["li", "td", "th", "blockquote"]);
const MIN_CONTENT_CHARS = 40;

export function extractContent(
  html: string,
  url: string,
): { title: string; content: string } | null {
  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url;

  $(STRIP_SELECTORS).remove();

  const candidates = [$("main").first(), $("article").first(), $('[role="main"]').first()];
  const root = candidates.find((c) => c.length > 0) ?? $("body");

  const lines: string[] = [];
  for (const el of root.find(BLOCK_SELECTOR).toArray()) {
    const tag = el.tagName.toLowerCase();
    if (CONTAINERISH.has(tag) && $(el).find(BLOCK_SELECTOR).length > 0) continue;
    // Preserve line structure in code blocks; collapse whitespace elsewhere.
    const text =
      tag === "pre"
        ? $(el)
            .text()
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        : $(el).text().replace(/\s+/g, " ").trim();
    if (!text) continue;
    const headingLevel = /^h([1-6])$/.exec(tag)?.[1];
    lines.push(headingLevel ? `${"#".repeat(Number(headingLevel))} ${text}` : text);
  }

  const content = lines.join("\n\n");
  if (content.length < MIN_CONTENT_CHARS) return null; // likely a JS-rendered shell
  return { title, content };
}
