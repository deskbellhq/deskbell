import { load } from "cheerio";
import { z } from "zod";
import type { Connector, RawDocument } from "../index";
import { extractContent } from "./extract";

const ConfigSchema = z.object({
  /** Start URL — sitemap.xml is auto-discovered from the origin. */
  url: z.string().url(),
  /** Only crawl paths matching these prefixes; empty = whole site. */
  includePaths: z.array(z.string()).default([]),
  maxPages: z.number().int().positive().max(10_000).default(500),
});

type Config = z.infer<typeof ConfigSchema>;

const USER_AGENT = "DeskbellBot/0.1 (+https://github.com/deskbellhq/deskbell)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 2_000_000;
const POLITENESS_DELAY_MS = 250; // AGENTS.md: rate-limit external fetches
const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|tar|mp[34]|webm|woff2?|ttf|eot|map)$/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normalize for the visited-set: resolve, strip fragments, http(s) + HTML-ish only. */
function normalizeUrl(raw: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (SKIP_EXTENSIONS.test(url.pathname)) return null;
  url.hash = "";
  return url.toString();
}

interface Robots {
  disallow: string[];
  sitemaps: string[];
}

/** Minimal robots.txt: Disallow prefixes from the `User-agent: *` group + Sitemap lines. */
async function fetchRobots(origin: string): Promise<Robots> {
  const robots: Robots = { disallow: [], sitemaps: [] };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return robots;
    let inStarGroup = false;
    for (const rawLine of (await res.text()).split("\n")) {
      const line = rawLine.replace(/#.*$/, "").trim();
      const [rawKey, ...rest] = line.split(":");
      if (!rawKey || rest.length === 0) continue;
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") inStarGroup = value === "*";
      else if (key === "sitemap" && value) robots.sitemaps.push(value);
      else if (key === "disallow" && inStarGroup && value) robots.disallow.push(value);
    }
  } catch {
    // unreachable robots.txt = no restrictions
  }
  return robots;
}

async function fetchPage(url: string): Promise<{ finalUrl: string; html: string } | null> {
  await sleep(POLITENESS_DELAY_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, MAX_BODY_CHARS);
    return { finalUrl: normalizeUrl(res.url, url) ?? url, html };
  } catch {
    return null;
  }
}

/** Collect page URLs from sitemaps (one level of sitemapindex nesting). */
async function collectSitemapUrls(
  sitemapUrls: string[],
  passes: (url: string) => boolean,
  maxPages: number,
): Promise<string[]> {
  const pages: string[] = [];
  const queue = [...sitemapUrls];
  let indexDepth = 0;
  while (queue.length > 0 && pages.length < maxPages) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl) break;
    try {
      const res = await fetch(sitemapUrl, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const $ = load(await res.text(), { xmlMode: true });
      if ($("sitemapindex").length > 0 && indexDepth === 0) {
        indexDepth = 1; // one level only (spec: mvp-end-to-end)
        for (const el of $("sitemap > loc").toArray()) queue.push($(el).text().trim());
        continue;
      }
      for (const el of $("url > loc").toArray()) {
        const normalized = normalizeUrl($(el).text().trim(), sitemapUrl);
        if (normalized && passes(normalized) && !pages.includes(normalized)) {
          pages.push(normalized);
          if (pages.length >= maxPages) break;
        }
      }
    } catch {
      // skip unreadable sitemap
    }
  }
  return pages;
}

export const docsCrawler: Connector<Config> = {
  type: "docs-crawler",
  displayName: "Docs website",
  configSchema: ConfigSchema,

  /** Sitemap-first, same-origin BFS fallback. Respects robots.txt (spec: docs-crawler). */
  async *discover(config): AsyncIterable<RawDocument> {
    const start = new URL(config.url);
    const origin = start.origin;
    const robots = await fetchRobots(origin);

    const passes = (candidate: string): boolean => {
      const url = new URL(candidate);
      if (url.origin !== origin) return false;
      if (
        config.includePaths.length > 0 &&
        !config.includePaths.some((p) => url.pathname.startsWith(p))
      ) {
        return false;
      }
      return !robots.disallow.some((prefix) => url.pathname.startsWith(prefix));
    };

    const visited = new Set<string>();
    let yielded = 0;

    const visit = async function* (pageUrl: string, collectLinks?: string[]) {
      if (visited.has(pageUrl)) return;
      visited.add(pageUrl);
      const page = await fetchPage(pageUrl);
      if (!page) return;
      visited.add(page.finalUrl);
      if (collectLinks) {
        const $ = load(page.html);
        for (const el of $("a[href]").toArray()) {
          const href = $(el).attr("href");
          const normalized = href ? normalizeUrl(href, page.finalUrl) : null;
          if (normalized && !visited.has(normalized) && passes(normalized)) {
            collectLinks.push(normalized);
          }
        }
      }
      const doc = extractContent(page.html, page.finalUrl);
      if (!doc) return;
      yielded++;
      yield {
        externalId: page.finalUrl,
        url: page.finalUrl,
        title: doc.title,
        content: doc.content,
      } satisfies RawDocument;
    };

    const sitemapSeeds = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origin}/sitemap.xml`];
    const sitemapPages = await collectSitemapUrls(sitemapSeeds, passes, config.maxPages);

    if (sitemapPages.length > 0) {
      for (const pageUrl of sitemapPages) {
        if (yielded >= config.maxPages) return;
        yield* visit(pageUrl);
      }
      return;
    }

    // No usable sitemap — same-origin BFS from the start URL.
    const queue: string[] = [normalizeUrl(config.url, config.url) ?? config.url];
    while (queue.length > 0 && yielded < config.maxPages) {
      const next = queue.shift();
      if (!next) break;
      yield* visit(next, queue);
    }
  },
};
