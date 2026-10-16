/**
 * Canonicalize user input to a browser Origin-header value, or null.
 *
 * Rule: http(s) scheme + host + optional non-default port — nothing else.
 * `URL.origin` lowercases the host and strips default ports, which is exactly
 * the form the browser sends in the Origin header and lib/widget-cors.ts
 * compares with strict includes() — anything less canonical would silently
 * never match (spec: single-tag-embed-deploy-onboarding).
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim();
  // "null" is the opaque Origin header (sandboxed iframes, file://) — never allowlistable.
  if (!raw || raw === "null") return null;
  // UX: a bare host like "app.example.com" reads as https.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null; // origins have no path
  return url.origin;
}
