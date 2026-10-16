import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

/**
 * Served at `/docs/sitemap.xml`. The marketing site owns `robots.txt` for the
 * domain, because the rewrite only covers `/docs/*` — that file is where this
 * sitemap gets referenced.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: absoluteUrl(page.slugs),
    lastModified: new Date(page.data.updated),
  }));
}
