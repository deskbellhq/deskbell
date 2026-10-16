import { describe, expect, it } from "vitest";

import { emailDomain, oauthDecision } from "./hooks";

const now = new Date("2026-09-18T10:00:00Z");
const base = {
  emailVerified: true,
  userCount: 3,
  invitation: null,
  domain: "example.com",
  allowedDomains: [] as string[],
  hasMembership: false,
  now,
};

describe("oauthDecision", () => {
  it("admits the first user and an invited address on create", () => {
    expect(oauthDecision({ ...base, action: "create-user", userCount: 0 })).toBe("first-user");
    expect(
      oauthDecision({
        ...base,
        action: "create-user",
        invitation: { status: "pending", expiresAt: new Date("2026-09-19T00:00:00Z") },
      }),
    ).toBe("invited");
    expect(
      oauthDecision({
        ...base,
        action: "create-user",
        invitation: { status: "pending", expiresAt: new Date("2026-09-17T00:00:00Z") },
      }),
    ).toBe("closed");
  });

  it("admits an allowed domain on create and closes the rest", () => {
    expect(oauthDecision({ ...base, action: "create-user", allowedDomains: ["example.com"] })).toBe(
      "domain",
    );
    expect(oauthDecision({ ...base, action: "create-user", allowedDomains: ["other.org"] })).toBe(
      "closed",
    );
    expect(oauthDecision({ ...base, action: "create-user" })).toBe("closed");
  });

  it("keeps an existing member, and applies the list to a known user without one", () => {
    expect(
      oauthDecision({
        ...base,
        action: "sign-in",
        hasMembership: true,
        allowedDomains: ["other.org"],
      }),
    ).toBe("existing");
    expect(oauthDecision({ ...base, action: "sign-in" })).toBe("existing");
    expect(
      oauthDecision({ ...base, action: "link-account", allowedDomains: ["example.com"] }),
    ).toBe("domain");
    expect(oauthDecision({ ...base, action: "sign-in", allowedDomains: ["other.org"] })).toBe(
      "domain-denied",
    );
  });

  it("refuses an address the provider has not verified, whatever else holds", () => {
    expect(
      oauthDecision({
        ...base,
        action: "create-user",
        emailVerified: false,
        userCount: 0,
        allowedDomains: ["example.com"],
      }),
    ).toBe("unverified-email");
  });
});

describe("emailDomain", () => {
  it("takes the part after the last @, lower-cased", () => {
    expect(emailDomain("Ada@Example.COM")).toBe("example.com");
    expect(emailDomain("no-at")).toBe("");
    expect(emailDomain("a@b@c.io")).toBe("c.io");
  });
});
