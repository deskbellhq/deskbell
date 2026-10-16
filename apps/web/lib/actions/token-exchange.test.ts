import { describe, expect, it } from "vitest";
import { exchangeVisitorToken, tokenEndpointFor } from "./token-exchange";

/**
 * The exchange against a fetch stub standing in for an identity provider
 * (spec: visitor-token-actions): the endpoint comes from discovery, the
 * request is the RFC 8693 form with the row's audience and scope, and a
 * provider that refuses is reported in its own words.
 */

const ISSUER = "https://auth.example.com/realms/shop";

function provider(opts: { tokenStatus?: number; tokenBody?: unknown } = {}) {
  const calls: Array<{ url: string; body: string | null; headers: Record<string, string> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      body: request.method === "POST" ? await request.text() : null,
      headers: Object.fromEntries(request.headers.entries()),
    });
    if (request.url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: ISSUER, token_endpoint: `${ISSUER}/protocol/token` });
    }
    if (request.url === `${ISSUER}/protocol/token`) {
      return Response.json(opts.tokenBody ?? { access_token: "exchanged.jwt", expires_in: 300 }, {
        status: opts.tokenStatus ?? 200,
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

describe("tokenEndpointFor", () => {
  it("reads the token endpoint from the issuer's discovery document", async () => {
    const { fetchImpl } = provider();
    await expect(tokenEndpointFor(ISSUER, { fetch: fetchImpl })).resolves.toBe(
      `${ISSUER}/protocol/token`,
    );
    // A trailing slash on the issuer is not a second issuer.
    await expect(tokenEndpointFor(`${ISSUER}/`, { fetch: fetchImpl })).resolves.toBe(
      `${ISSUER}/protocol/token`,
    );
  });

  it("refuses an endpoint on a private address", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ token_endpoint: "http://10.0.0.5/token" });
    await expect(tokenEndpointFor(ISSUER, { fetch: fetchImpl })).rejects.toThrow(/Token endpoint/);
  });
});

describe("exchangeVisitorToken", () => {
  it("posts the RFC 8693 form and returns the access token", async () => {
    const { fetchImpl, calls } = provider();
    const token = await exchangeVisitorToken(
      {
        issuer: ISSUER,
        subjectToken: "visitor.jwt",
        client: {
          clientId: "deskbell",
          clientSecret: "s3cret",
          audience: "shop-mcp",
          scope: "orders:read",
        },
      },
      { fetch: fetchImpl },
    );
    expect(token).toBe("exchanged.jwt");
    const post = calls.find((c) => c.body !== null);
    expect(post?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(post?.body ?? "");
    expect(Object.fromEntries(form.entries())).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "visitor.jwt",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: "deskbell",
      client_secret: "s3cret",
      audience: "shop-mcp",
      scope: "orders:read",
    });
  });

  it("leaves audience and scope out when the row has none", async () => {
    const { fetchImpl, calls } = provider();
    await exchangeVisitorToken(
      {
        issuer: ISSUER,
        subjectToken: "visitor.jwt",
        client: { clientId: "deskbell", clientSecret: "s3cret", audience: null, scope: null },
      },
      { fetch: fetchImpl },
    );
    const form = new URLSearchParams(calls.find((c) => c.body !== null)?.body ?? "");
    expect(form.has("audience")).toBe(false);
    expect(form.has("scope")).toBe(false);
  });

  it("reports the provider's refusal", async () => {
    const { fetchImpl } = provider({
      tokenStatus: 400,
      tokenBody: { error: "invalid_grant", error_description: "Client not allowed to exchange" },
    });
    await expect(
      exchangeVisitorToken(
        {
          issuer: ISSUER,
          subjectToken: "visitor.jwt",
          client: { clientId: "deskbell", clientSecret: "s3cret" },
        },
        { fetch: fetchImpl },
      ),
    ).rejects.toThrow("Client not allowed to exchange");
  });
});
