import type { ProjectIdentity } from "@deskbell/shared";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { claimMatches, verifyEndUserToken } from "./verify";

const ISSUER = "https://id.example.test/realms/app";

let sign: (
  claims: Record<string, unknown>,
  opts?: { exp?: string; iss?: string },
) => Promise<string>;
let identity: ProjectIdentity;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  identity = {
    issuer: ISSUER,
    audience: "widget",
    required: false,
    jwks: { keys: [{ ...jwk, kid: "k1", alg: "ES256" }] },
  };
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience("widget")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
});

describe("verifyEndUserToken", () => {
  it("returns the subject and profile claims of a valid token", async () => {
    const token = await sign({ sub: "u1", email: "a@b.test", name: "Ada" });
    const verified = await verifyEndUserToken(token, identity);
    expect(verified).toMatchObject({
      issuer: ISSUER,
      subject: "u1",
      email: "a@b.test",
      name: "Ada",
    });
  });

  it("falls back to preferred_username for the name", async () => {
    const token = await sign({ sub: "u2", preferred_username: "ada" });
    expect((await verifyEndUserToken(token, identity)).name).toBe("ada");
  });

  it("rejects a wrong issuer, a wrong audience, an expired token and a missing subject", async () => {
    await expect(
      verifyEndUserToken(await sign({ sub: "u" }, { iss: "https://other.test" }), identity),
    ).rejects.toThrow();
    await expect(
      verifyEndUserToken(await sign({ sub: "u" }), { ...identity, audience: "other" }),
    ).rejects.toThrow();
    await expect(
      verifyEndUserToken(await sign({ sub: "u" }, { exp: "-2h" }), identity),
    ).rejects.toThrow();
    await expect(verifyEndUserToken(await sign({}), identity)).rejects.toThrow(/subject/);
  });

  it("rejects a token signed by another key, and garbage", async () => {
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({ sub: "u" })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience("widget")
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verifyEndUserToken(forged, identity)).rejects.toThrow();
    await expect(verifyEndUserToken("not.a.jwt", identity)).rejects.toThrow();
  });

  it("fails closed when the project names no key source", async () => {
    const token = await sign({ sub: "u" });
    await expect(verifyEndUserToken(token, { issuer: ISSUER, required: false })).rejects.toThrow(
      /jwks/,
    );
  });
});

describe("claimMatches", () => {
  it("matches a scalar by path and an array by membership", () => {
    const claims = { realm_access: { roles: ["support", "user"] }, role: "staff" };
    expect(claimMatches(claims, "realm_access.roles", "support")).toBe(true);
    expect(claimMatches(claims, "realm_access.roles", "admin")).toBe(false);
    expect(claimMatches(claims, "role", "staff")).toBe(true);
    expect(claimMatches(claims, "missing.path", "x")).toBe(false);
  });
});
