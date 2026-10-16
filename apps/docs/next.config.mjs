import { createMDX } from "fumadocs-mdx/next";
import { redirects } from "./redirects.mjs";

const withMDX = createMDX();

/**
 * The documentation is served at `deskbell.dev/docs`, which the marketing site
 * reaches by rewriting `/docs/:path*` here. `basePath` is what makes this
 * deployment agree with that: it prefixes every route and asset, so pages are
 * authored at the app root and land under `/docs`.
 *
 * Consequence worth remembering: a page directory named `docs/` would produce
 * `/docs/docs/…`. Pages live in `app/[[...slug]]`.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  basePath: "/docs",
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TS source; Next transpiles them.
  transpilePackages: ["@deskbell/shared"],

  // Pages that moved keep answering at their old address. Next prepends
  // `basePath` to both sides, so the table is written without it.
  async redirects() {
    return redirects.map((entry) => ({ ...entry, permanent: true }));
  },

  async headers() {
    return [
      {
        source: "/:path*",
        // Applies when the request did not arrive through the canonical
        // domain, i.e. someone opened this deployment's own URL directly.
        // The site reaches us through a rewrite, which keeps the original
        // host in `x-forwarded-host` while `host` becomes ours; checking
        // `host` would mark the canonical pages noindex too. Pages carry a
        // canonical pointing at deskbell.dev; without this header the two
        // hosts compete for the same content and both lose.
        missing: [{ type: "header", key: "x-forwarded-host", value: "deskbell.dev" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default withMDX(config);
