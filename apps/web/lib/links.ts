/**
 * External destinations used across the dashboard chrome
 * (spec: dashboard-ia-settings). One place so the sidebar, header, command
 * palette and star card can never drift apart.
 */
export const GITHUB_URL = "https://github.com/deskbellhq/deskbell";
export const DOCS_URL = "https://deskbell.dev/docs";

/** Docs pages the dashboard links to by name, so a moved page is one edit here. */
export const DOCS_WIDGET_INSTALL_URL = `${DOCS_URL}/widget/install`;
export const DOCS_MODELS_URL = `${DOCS_URL}/deploy/models`;
export const DOCS_ACTIONS_URL = `${DOCS_URL}/actions/mcp-servers`;
/** There is no troubleshooting page; the quickstart's "Common problems" is it. */
export const DOCS_QUICKSTART_PROBLEMS_URL = `${DOCS_URL}/quickstart#common-problems`;
