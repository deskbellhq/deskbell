/**
 * Old slug -> new slug, for pages that moved when the site gained sections.
 *
 * Written without the `/docs` prefix: Next prepends `basePath` to both sides
 * of every redirect on its own. Redirects run before routing, so a source
 * must never be a live page (it would shadow it); `lib/redirects.test.ts`
 * checks that, and that every destination exists. An absolute destination
 * leaves the site: Next passes it through untouched.
 */
export const redirects = [
  { source: "/status", destination: "/" },
  { source: "/self-hosting/configuration", destination: "/deploy/environment-variables" },
  { source: "/self-hosting/:path*", destination: "/deploy/:path*" },
  { source: "/sources/crawler", destination: "/knowledge/website" },
  { source: "/sources/reindexing", destination: "/knowledge/re-indexing" },
  { source: "/sources/:path*", destination: "/knowledge/:path*" },
  { source: "/widget/customization", destination: "/widget/configuration" },
  { source: "/widget/sdk", destination: "/developer/sdk" },
  { source: "/docs-gaps", destination: "/operate/gaps" },
  { source: "/notifications", destination: "/operate/notifications" },
  { source: "/evaluation", destination: "/operate/evaluation" },
  { source: "/security", destination: "/manage/security" },
  { source: "/contributing", destination: "/developer/contributing" },
  { source: "/roadmap", destination: "https://deskbell.dev/#roadmap" },
];
