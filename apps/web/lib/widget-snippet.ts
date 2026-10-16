import { DOCS_WIDGET_INSTALL_URL } from "./links";

/**
 * The embed snippets, built in one place (spec: overview-getting-started).
 * The Install page and the getting-started page both render them, and two
 * hand-written copies of a tag whose entire job is to be pasted verbatim
 * would drift the first time one of them is edited. Pure: no Next imports,
 * so the strings are unit-tested exactly as they are shown.
 *
 * The one-tag form derives its API origin from its own `src`, so the base
 * URL is the only thing that varies (spec: single-tag-embed-deploy-onboarding).
 */

function trimSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The recommended install: one tag, the loader mounts the element itself. */
export function oneTagSnippet(baseUrl: string, projectKey: string): string {
  return `<script async src="${trimSlash(baseUrl)}/deskbell.js" data-project-key="${projectKey}"></script>`;
}

/** The advanced install: place the element yourself, name the API explicitly. */
export function manualSnippet(baseUrl: string, projectKey: string): string {
  const base = trimSlash(baseUrl);
  return `<script async src="${base}/deskbell.js"></script>
<deskbell-widget
  project-key="${projectKey}"
  api-url="${base}"
></deskbell-widget>`;
}

/**
 * A prompt for a coding agent working in the site's codebase. It carries
 * everything the agent needs — the exact tag, the CSP consequence, the two
 * ways to install it twice by accident, and the allowlist step that is not
 * a code change — so nothing else has to be installed for it to do the job.
 */
export function agentPrompt(
  baseUrl: string,
  projectKey: string,
  docsUrl: string = DOCS_WIDGET_INSTALL_URL,
): string {
  const base = trimSlash(baseUrl);
  return `Add the Deskbell docs-answering widget to this site.

1. Add this tag once per page, just before </body> — in the shared layout or
   template if the site has one:

   ${oneTagSnippet(base, projectKey)}

2. If the site sends a Content-Security-Policy, allow ${base} in both
   script-src (the widget bundle) and connect-src (its API and the answer
   stream). Nothing else is needed: the widget renders in a shadow root and
   loads no fonts or images from elsewhere.

3. Do not add the tag twice and do not add a <deskbell-widget> element as
   well — the script mounts the element itself.

4. The site's origin (scheme, host, port) must be on the project's allowlist
   in the Deskbell dashboard under Settings › Install. That is a dashboard
   setting, not a code change; the dashboard verifies the install on its own
   once the widget loads.

Reference: ${docsUrl}`;
}
