import { validateWebhookUrl } from "@deskbell/shared";
import { type DeliveryResult, RetryableDeliveryError } from "./types";

export const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * One POST of a JSON body (spec: project-notifications). The URL is checked
 * again here — the row could have been written by a path other than the
 * settings action — and never logged; a host is enough to tell which
 * receiver failed. Redirects are not followed: a 3xx from a webhook address
 * is a misconfiguration, and following one would send a signed body to a
 * host the operator did not name.
 */
export async function postJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryResult> {
  const check = validateWebhookUrl(url);
  if (!check.ok) return { status: "rejected", error: `invalid url: ${check.reason}` };
  const host = new URL(check.url).host;
  let res: Response;
  try {
    res = await fetchImpl(check.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "deskbell/notifications",
        ...headers,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "error";
    throw new RetryableDeliveryError(`${host}: ${reason}`);
  }
  return classify(res.status, host);
}

/** Exported for the test: the retry/reject line in one place. */
export function classify(status: number, host: string): DeliveryResult {
  if (status >= 200 && status < 300) return { status: "delivered" };
  if (status >= 500 || status === 429) throw new RetryableDeliveryError(`${host}: ${status}`);
  return { status: "rejected", error: `${host}: ${status}` };
}
