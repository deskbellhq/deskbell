/**
 * Where a notification may be sent (spec: project-notifications). The URL is
 * operator-supplied and the worker will POST to it, so the rules are the
 * usual ones for outbound requests to an address someone typed: https, no
 * credentials, no literal private addresses. Dependency-free: the same
 * function runs in the settings action and in the worker before every
 * request, and either could be a browser one day.
 *
 * Hostnames are deliberately allowed even when they resolve to a private
 * address: a self-hoster's receiver on the same network is a valid target,
 * and refusing it would push people to expose it publicly.
 */

export const WEBHOOK_URL_MAX_CHARS = 2048;

export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateWebhookUrl(raw: string): WebhookUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "Enter a URL." };
  if (trimmed.length > WEBHOOK_URL_MAX_CHARS) {
    return { ok: false, reason: `The URL must be at most ${WEBHOOK_URL_MAX_CHARS} characters.` };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Enter a full URL, e.g. https://hooks.example.com/…" };
  }
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    return { ok: false, reason: "The URL must use https (http is allowed for localhost only)." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "The URL must not carry credentials." };
  }
  if (!loopback && isPrivateAddress(host)) {
    return { ok: false, reason: "The URL must not point at a private or link-local address." };
  }
  return { ok: true, url: url.toString() };
}

/**
 * Literal IPv4 and IPv6 addresses in the ranges nothing on the public
 * internet should answer from. Names are not resolved here.
 */
export function isPrivateAddress(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (
      v6.startsWith("fe8") ||
      v6.startsWith("fe9") ||
      v6.startsWith("fea") ||
      v6.startsWith("feb")
    )
      return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice("::ffff:".length));
    return false;
  }
  return false;
}

/**
 * What the settings page shows instead of a stored URL: the origin and an
 * ellipsis, enough to recognise which receiver it is and nothing an operator
 * could paste into a curl.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}/…`;
  } catch {
    return "…";
  }
}

/** The first characters of a secret, enough to tell two apart. */
export function maskSecret(secret: string, keep = 10): string {
  return `${secret.slice(0, keep)}…`;
}
