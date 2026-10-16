import { headers } from "next/headers";

/**
 * Canonical external origin of this deployment, for rendering embed snippets
 * (spec: single-tag-embed-deploy-onboarding). DESKBELL_PUBLIC_URL wins;
 * otherwise derived from proxy/request headers. Snippet rendering only — the
 * widget itself never needs it (the loader derives its API from script.src).
 */
export async function getPublicBaseUrl(): Promise<string> {
  const env = process.env.DESKBELL_PUBLIC_URL;
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // Misconfigured env falls back to the request-derived origin below.
    }
  }
  return getRequestOrigin();
}

/** The origin the current request was addressed to, per proxy headers. */
export async function getRequestOrigin(): Promise<string> {
  return originFromHeaders(await headers()) ?? "http://localhost:3000";
}

/**
 * Same derivation, off a Headers object rather than the async request store.
 * Null when there is no host at all, so a caller never renders a made-up origin.
 *
 * Only for places that need a whole URL — the embed snippet, and display. For
 * "is this origin us?", compare hosts via selfHosts() below; a comparison that
 * includes the scheme inherits the guess made here.
 */
export function originFromHeaders(h: Headers): string | null {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  return `${schemeFor(h, host)}://${host}`;
}

/**
 * The scheme the *browser* used, which we cannot actually observe.
 *
 * Next always populates x-forwarded-proto — from its own socket when the client
 * sent none — so `http` there means "nobody told us", not "the browser used
 * http" (see selfHosts() below). Behind a TLS-terminating proxy that forwards
 * Host but not X-Forwarded-Proto, an ordinary nginx config, that is exactly
 * what we get while the browser is on https.
 *
 * So it is a guess everywhere except localhost, and the guess is picked by
 * which way it hurts. Guess http on an https deployment and the Deploy page
 * renders `http://…/deskbell.js`, which every customer's https page then
 * refuses as mixed content — a snippet that is broken for everyone who copies
 * it. Guess https on a genuinely plaintext deployment and the widget fails to
 * load there, which only reaches customers whose own pages are already
 * plaintext and thus already unable to embed it. DESKBELL_PUBLIC_URL is the
 * escape hatch for that case and wins outright.
 */
function schemeFor(h: Headers, host: string): "http" | "https" {
  if (h.get("x-forwarded-proto") === "https") return "https";
  return isLoopback(host) ? "http" : "https";
}

/** Hostname without the port, IPv6 literals kept bracketed. */
export function hostOfOrigin(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  const name = lower.startsWith("[")
    ? lower.slice(0, lower.indexOf("]") + 1)
    : (lower.split(":")[0] ?? "");
  return (
    name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]"
  );
}

/**
 * Hosts that ARE this deployment: what a browser sends when the dashboard's own
 * dogfooded widget calls the API (spec: widget-abuse-protection).
 *
 * HOSTS, not origins — the scheme is deliberately not compared, because we
 * cannot learn it reliably. Next always populates x-forwarded-proto, from its
 * OWN socket when the client sent none (verified: a request with no
 * x-forwarded-proto arrives at the route handler carrying `http`). Behind a
 * TLS-terminating proxy that forwards Host but not X-Forwarded-Proto — an
 * ordinary nginx config — we would therefore derive http://… while the browser
 * sent https://…, miss, and fence the operator out of their own dashboard with
 * the allowlist innocent: the exact bug this exemption exists to fix, wearing a
 * different hat. Treating an absent header as "unknown scheme" does not help,
 * because it is never absent.
 *
 * Dropping the scheme costs nothing here. To exploit it, someone would have to
 * serve the same host over the other scheme — which means they already control
 * the deployment or the network path to it, and the origin check was never what
 * stood between them and it.
 *
 * DESKBELL_PUBLIC_URL is included for proxies that forward no usable host at
 * all, leaving the request-derived value as the internal one.
 */
export function selfHosts(
  h: Headers,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const hosts = new Set<string>();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) hosts.add(host.toLowerCase());
  if (env.DESKBELL_PUBLIC_URL) {
    try {
      hosts.add(new URL(env.DESKBELL_PUBLIC_URL).host.toLowerCase());
    } catch {
      // Misconfigured env — the request-derived host still applies.
    }
  }
  return [...hosts];
}

/** selfHosts() off the async request store, for Server Components. */
export async function getSelfHosts(): Promise<string[]> {
  return selfHosts(await headers());
}
