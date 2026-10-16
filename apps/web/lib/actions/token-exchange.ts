import { validateWebhookUrl } from "@deskbell/shared";

/**
 * The visitor's token, made acceptable to an MCP server (spec:
 * visitor-token-actions). A server that is a resource server of the
 * project's identity provider wants a token addressed to it, not the one
 * the provider issued for the product the widget sits in. RFC 8693 token
 * exchange asks the provider for exactly that: the visitor's token goes in
 * as the subject, a token for the server's audience comes out, and the
 * client Deskbell authenticates with is the one the operator registered.
 *
 * The token endpoint is read from the issuer's OpenID discovery document
 * and remembered per process. Both URLs pass the webhook checks: the issuer
 * is operator-configured, the endpoint comes from a document that issuer
 * served, and neither may point the instance at its own network.
 */

export const EXCHANGE_TIMEOUT_MS = 5000;
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

export interface ExchangeClient {
  clientId: string;
  clientSecret: string;
  audience?: string | null;
  scope?: string | null;
}

export interface ExchangeOptions {
  fetch?: typeof fetch;
}

const endpoints = new Map<string, Promise<string>>();

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string; error_description?: string }).error_description ||
          (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(error.slice(0, 200));
  }
  return body;
}

/** The issuer's token endpoint, from its discovery document. */
export function tokenEndpointFor(issuer: string, opts: ExchangeOptions = {}): Promise<string> {
  const fetchImpl = opts.fetch;
  const key = issuer.replace(/\/+$/, "");
  let pending = fetchImpl ? undefined : endpoints.get(key);
  if (!pending) {
    pending = (async () => {
      const issuerCheck = validateWebhookUrl(key);
      if (!issuerCheck.ok) throw new Error(`Identity issuer: ${issuerCheck.reason}`);
      const doc = await fetchJson(
        `${key}/.well-known/openid-configuration`,
        { headers: { accept: "application/json" } },
        fetchImpl ?? fetch,
      );
      const endpoint =
        doc && typeof doc === "object"
          ? (doc as { token_endpoint?: unknown }).token_endpoint
          : undefined;
      if (typeof endpoint !== "string") {
        throw new Error("The identity provider's discovery document names no token endpoint");
      }
      const check = validateWebhookUrl(endpoint);
      if (!check.ok) throw new Error(`Token endpoint: ${check.reason}`);
      return check.url;
    })();
    if (!fetchImpl) {
      endpoints.set(key, pending);
      pending.catch(() => endpoints.delete(key));
    }
  }
  return pending;
}

/** Test seam: forget discovered endpoints. */
export function resetTokenEndpoints(): void {
  endpoints.clear();
}

/**
 * Exchange the visitor's token for one the server accepts. Returns the
 * access token; the caller sends it as the bearer and keeps nothing.
 */
export async function exchangeVisitorToken(
  input: { issuer: string; subjectToken: string; client: ExchangeClient },
  opts: ExchangeOptions = {},
): Promise<string> {
  const endpoint = await tokenEndpointFor(input.issuer, opts);
  const form = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: input.subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    client_id: input.client.clientId,
    client_secret: input.client.clientSecret,
  });
  if (input.client.audience) form.set("audience", input.client.audience);
  if (input.client.scope) form.set("scope", input.client.scope);
  const body = await fetchJson(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form,
    },
    opts.fetch ?? fetch,
  );
  const token =
    body && typeof body === "object"
      ? (body as { access_token?: unknown }).access_token
      : undefined;
  if (typeof token !== "string" || !token) {
    throw new Error("The identity provider returned no access token");
  }
  return token;
}
