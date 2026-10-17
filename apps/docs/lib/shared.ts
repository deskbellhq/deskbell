/**
 * Site-wide constants. Everything that names a URL, a repository path or the
 * launch state lives here so the pages never hard-code one.
 */

export const appName = "Deskbell";

/** Where this site is served from. `basePath` in next.config.mjs must match `docsPrefix`. */
export const siteUrl = "https://deskbell.dev";
export const docsPrefix = "/docs";

/** Community chat. Independent of the repository, so never gated by LAUNCH_MODE. */
export const discordUrl = "https://discord.gg/fJNPQ4ckE";

/**
 * Pages mount at the app root and `basePath` supplies `/docs`, so the loader's
 * base URL is `/`. Next prefixes links and assets on its own.
 */
export const docsRoute = "/";

/**
 * The search endpoint, including the prefix.
 *
 * The search dialog fetches this from the browser, and a client-side fetch does
 * not inherit Next's `basePath`. Left as the bare default it would request a
 * path that does not exist, return nothing, and look exactly like a search that
 * works but finds no matches. `lib/routing.test.ts` pins it to the prefix.
 */
export const searchApiUrl = `${docsPrefix}/api/search`;

/** Routes that serve a page's own Markdown to agents and to the copy button. */
export const docsContentRoute = "/llms.mdx";

export const gitConfig = {
  user: "deskbellhq",
  repo: "deskbell",
  branch: "main",
  /**
   * The content directory, relative to the repository root. In a monorepo this
   * is not the repository root, and a base that omits `apps/docs` produces an
   * edit link that 404s on every page. `edit-links.test.ts` pins it.
   */
  contentDir: "apps/docs/content/docs",
};

/**
 * Flip to "public" when `deskbellhq/deskbell` opens. Until then, links into the
 * repository render as plain text rather than 404s.
 *
 * The `as` cast rather than a type annotation is deliberate: a `const` with a
 * union *annotation* narrows to its initializer, which makes comparing against
 * the other member a compile error. Flipping this must stay a one-word edit.
 */
export const LAUNCH_MODE = "prelaunch" as "prelaunch" | "public";
export const repoIsPublic = LAUNCH_MODE === "public";

/** The repository URL, or null before launch. Consumers render null as inert. */
export function repoHref(path = ""): string | null {
  if (!repoIsPublic) return null;
  return `https://github.com/${gitConfig.user}/${gitConfig.repo}${path}`;
}

/** Absolute URL for a page, used for canonicals and the sitemap. */
export function absoluteUrl(slugs: string[]): string {
  return [siteUrl + docsPrefix, ...slugs].join("/");
}

/**
 * Absolute URL from a loader URL (`/`, `/quickstart`, `/widget/install`).
 *
 * The loader's base URL is `/` because Next applies `basePath` to links it
 * renders. Anything written into a file rather than rendered as a link misses
 * that, so a root-relative `/quickstart` in llms.txt points at
 * `deskbell.dev/quickstart`, which is the marketing site. Machine-readable
 * output is absolute for that reason.
 */
export function absoluteFromUrl(url: string): string {
  return url === "/" ? siteUrl + docsPrefix : siteUrl + docsPrefix + url;
}

/**
 * Link to a page's source on GitHub, or null before the repository opens.
 *
 * `pagePath` is the page's path relative to the content directory, which is
 * what the loader exposes as `page.path`. The repository path in front of it is
 * the part that goes wrong: a docs framework's default assumes the content
 * directory sits at the repository root, and in a monorepo it does not. The
 * resulting link 404s on every page and nobody notices, because maintainers
 * rarely click their own edit links. `lib/edit-links.test.ts` pins it.
 */
export function editUrl(pagePath: string): string | null {
  const { branch, contentDir } = gitConfig;
  return repoHref(`/blob/${branch}/${contentDir}/${pagePath}`);
}
