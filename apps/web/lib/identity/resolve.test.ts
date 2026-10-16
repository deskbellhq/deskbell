import { describe, expect, it } from "vitest";
import { bearerToken, resolveIdentity } from "./resolve";

const ISSUER = "https://id.test";
const verified = { issuer: ISSUER, subject: "u1", claims: {} };
const verify = async (token: string) => {
  if (token === "good") return verified;
  throw new Error("bad token");
};

describe("bearerToken", () => {
  it("extracts the token and ignores other schemes", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer x")).toBe("x");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("resolveIdentity", () => {
  it("is anonymous when the project verifies nothing, token or not", async () => {
    expect(await resolveIdentity({ authorization: "Bearer good", identity: {}, verify })).toEqual({
      kind: "anonymous",
    });
    expect(await resolveIdentity({ authorization: null, identity: null, verify })).toEqual({
      kind: "anonymous",
    });
  });

  it("allows anonymous callers unless identity is required", async () => {
    expect(
      await resolveIdentity({
        authorization: null,
        identity: { issuer: ISSUER, required: false },
        verify,
      }),
    ).toEqual({ kind: "anonymous" });
    expect(
      await resolveIdentity({
        authorization: null,
        identity: { issuer: ISSUER, required: true },
        verify,
      }),
    ).toEqual({ kind: "unauthorized", reason: "missing" });
  });

  it("verifies a good token and refuses a bad one even when anonymous is allowed", async () => {
    expect(
      await resolveIdentity({
        authorization: "Bearer good",
        identity: { issuer: ISSUER, required: false },
        verify,
      }),
    ).toEqual({ kind: "verified", identity: verified });
    expect(
      await resolveIdentity({
        authorization: "Bearer bad",
        identity: { issuer: ISSUER, required: false },
        verify,
      }),
    ).toEqual({ kind: "unauthorized", reason: "invalid" });
  });
});
