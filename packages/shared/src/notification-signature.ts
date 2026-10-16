/**
 * Signed webhook deliveries (spec: project-notifications). The worker signs
 * `{timestamp}.{body}` with the channel's secret; a receiver recomputes it
 * and compares in constant time. Web Crypto only, so the same code is the
 * reference implementation for a receiver in any runtime that has it, and
 * this MIT package stays free of Node-only imports.
 */

export const NOTIFICATION_SIGNATURE_VERSION = "v1";
export const NOTIFICATION_SIGNATURE_HEADER = "x-deskbell-signature";
export const NOTIFICATION_TIMESTAMP_HEADER = "x-deskbell-timestamp";
export const NOTIFICATION_DELIVERY_HEADER = "x-deskbell-delivery";
export const NOTIFICATION_EVENT_HEADER = "x-deskbell-event";
/** How old a delivery may be before a receiver should refuse it. */
export const NOTIFICATION_MAX_AGE_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The header value for a body sent at `timestamp` (unix milliseconds). */
export async function signNotification(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return `${NOTIFICATION_SIGNATURE_VERSION}=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

/**
 * True when `header` signs `body` at `timestamp` with `secret` and the
 * timestamp is within `maxAgeMs` of `now`. Any malformed input is false.
 */
export async function verifyNotificationSignature(input: {
  secret: string;
  timestamp: string | number;
  body: string;
  header: string;
  now?: number;
  maxAgeMs?: number;
}): Promise<boolean> {
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.now ?? Date.now();
  if (Math.abs(now - ts) > (input.maxAgeMs ?? NOTIFICATION_MAX_AGE_MS)) return false;
  const expected = await signNotification(input.secret, ts, input.body);
  return constantTimeEqual(expected, input.header.trim());
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A fresh signing secret: a recognisable prefix and 256 bits of randomness. */
export function newSigningSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64url = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `whsec_${b64url}`;
}
