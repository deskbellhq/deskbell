import { createHmac } from "node:crypto";

/**
 * Identifying the caller of a public endpoint (spec: widget-abuse-protection).
 * Pure functions — the request-time policy lives in ../widget-guard.ts.
 */

/**
 * The client IP, read from `x-forwarded-for` RIGHT-TO-LEFT.
 *
 * Direction is the whole security property. XFF grows by append, so the
 * rightmost entry is the peer closest to us — the one our own infrastructure
 * wrote — and the leftmost is whatever the client claimed. Reading left-to-right
 * (the common mistake) hands every attacker an unlimited supply of identities.
 *
 * `trustedProxies` is how many of our own hops to skip past: 0 for a direct
 * deployment (Next appends the socket address itself), 1 behind one reverse
 * proxy, and so on.
 */
export function clientIp(headers: Headers, trustedProxies: number): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    // Skipping past the end means the chain is shorter than configured — a
    // misconfiguration. Fall back to the leftmost entry rather than to nothing:
    // a spoofable identity still rate-limits honest traffic correctly.
    const index = hops.length - 1 - trustedProxies;
    const hop = hops[index >= 0 ? index : 0];
    if (hop) return normalizeIp(hop);
  }
  const real = headers.get("x-real-ip");
  return real ? normalizeIp(real.trim()) : null;
}

/** Strip an IPv6 zone id and the brackets/port form, so one client is one bucket. */
function normalizeIp(raw: string): string | null {
  let ip = raw.trim();
  if (!ip) return null;
  const bracketed = ip.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed?.[1]) ip = bracketed[1];
  // IPv4 with a port; bare IPv6 has many colons and must be left alone.
  else if (ip.split(":").length === 2) ip = ip.split(":")[0] ?? ip;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  return ip.toLowerCase() || null;
}

/**
 * Bucket identity for an IP. Raw addresses are PII (D12) and this table is not
 * where they should accumulate — the hash is enough to count with, and useless
 * to anyone reading the database.
 */
export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

/**
 * Non-browser clients on an endpoint only browsers should reach.
 *
 * Deliberately a short list of self-identifying agents — crawlers and default
 * HTTP-library UAs. It is a courtesy filter that keeps honest bots out of a
 * customer's LLM bill, NOT a security control: anyone can send any UA, which is
 * what the rate limits are for. Keeping it short keeps false positives near
 * zero; the real cost of over-matching is a silenced widget for a real visitor.
 *
 * "bot" needs a trailing `/`, space, or hyphen — `Googlebot/2.1` and
 * `AdsBot-Google` are bots, `CUBOT_X30` is a phone in a real Android UA.
 */
const BOT_UA =
  /(bot[/ -]|crawler|spider|crawling|slurp|scrapy|curl\/|wget\/|python-requests|python-urllib|httpx\/|aiohttp|go-http-client|java\/|okhttp|libwww-perl|axios\/|node-fetch|headlesschrome|phantomjs)/i;

export function isBotUserAgent(userAgent: string | null): boolean {
  if (!userAgent || userAgent.trim() === "") return true; // no UA at all is not a browser
  return BOT_UA.test(userAgent);
}
