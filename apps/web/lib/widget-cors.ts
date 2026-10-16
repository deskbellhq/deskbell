import type { AbuseConfig } from "./abuse/config";

/**
 * Origin policy and CORS headers for the public widget endpoints
 * (spec: widget-abuse-protection).
 *
 * A project's key is public — it ships in the customer's page source — so
 * origin binding, not key secrecy, is what stops a stranger spending their
 * tokens. This module decides; ./widget-guard.ts enforces.
 */

export type OriginVerdict =
  | { allowed: true; openToAll: boolean }
  | { allowed: false; reason: "not_allowed" | "unconfigured" | "missing_origin" };

export interface OriginCheck {
  origin: string | null;
  allowedOrigins: string[];
  /** GET is a CORS simple request, and same-origin GETs carry no Origin header. */
  method: string;
  /** Hosts that ARE this deployment — see the same-origin rule below. */
  selfHosts: string[];
  config: AbuseConfig;
}

export function checkOrigin({
  origin,
  allowedOrigins,
  method,
  selfHosts,
  config,
}: OriginCheck): OriginVerdict {
  // The opaque origin (sandboxed iframe, file://) is never allowlistable and
  // cannot be attributed to a site, so it is refused before anything else.
  if (origin === "null") return { allowed: false, reason: "not_allowed" };

  // Browsers ALWAYS send Origin on POST, so a POST without one is not a browser.
  // GET is different: same-origin GETs omit it, and a no-Origin GET cannot be
  // read cross-origin anyway — refusing it only breaks self-hosters serving the
  // widget from the same domain as the API.
  if (!origin && method !== "GET") return { allowed: false, reason: "missing_origin" };

  // The deployment talking to itself is never a third party. The dashboard
  // dogfoods the widget, so without this the operator's own instance answers
  // every customer site and refuses the one page they are looking at: on an
  // empty allowlist in production both /ask and /config 403, and — worse —
  // configuring the allowlist correctly does NOT fix /ask, because the
  // dashboard's origin is not the customer's site. The allowlist exists to stop
  // OTHER people's pages spending your tokens; it was never meant to fence you
  // out of your own.
  //
  // Not a weakening: a browser cannot forge Origin, and a script never needed
  // to — it can already claim any allowlisted origin. Origin binding is a
  // browser control; rate limits and the token budget are what stop scripts.
  // Matched on host, not full origin — see selfHosts() for why the scheme is
  // not knowable here and why dropping it costs nothing.
  if (!origin) return { allowed: true, openToAll: false }; // same-origin GET
  if (isSelf(origin, selfHosts)) return { allowed: true, openToAll: false };

  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin)
      ? { allowed: true, openToAll: false }
      : { allowed: false, reason: "not_allowed" };
  }

  // Nothing configured. Answering any origin is the right default while
  // developing and the wrong one in production, where an unconfigured project
  // is a public endpoint anyone can bill. Fail closed, with a documented opt-out
  // for embeds spread across many unknown domains.
  if (config.allowAnyOrigin || !config.isProduction) return { allowed: true, openToAll: true };
  return { allowed: false, reason: "unconfigured" };
}

/**
 * Headers for an origin that has already passed checkOrigin. A denied origin
 * gets no header at all — asserting `access-control-allow-origin` for a site we
 * just refused would be a lie the browser then acts on.
 */
export function corsHeaders(origin: string | null, verdict: OriginVerdict): Record<string, string> {
  if (!verdict.allowed) return {};
  if (verdict.openToAll) return { "access-control-allow-origin": "*" };
  if (origin) return { "access-control-allow-origin": origin, vary: "Origin" };
  return {}; // same-origin: the browser needs no grant
}

/**
 * Preflight cannot be project-scoped — OPTIONS carries no body and no key — so
 * it grants the browser permission to *send* the request; the POST-side check
 * in ./widget-guard.ts is the actual boundary. Refusing there rather than here
 * is what turns a would-be opaque CORS failure into a readable 403.
 */
export function preflight(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin ?? "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      // authorization: the end-user bearer (spec: end-user-identity). Granting
      // it here only lets the browser SEND it; the guard decides what it means.
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}

/** Origin is browser-supplied; a malformed one is simply not us. */
function isSelf(origin: string, selfHosts: string[]): boolean {
  try {
    return selfHosts.includes(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}
