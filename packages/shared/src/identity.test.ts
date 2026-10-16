import { describe, expect, it } from "vitest";
import {
  AskRequestSchema,
  ConversationContextSchema,
  ConversationListRequestSchema,
  ConversationRenameRequestSchema,
  ProjectIdentitySchema,
  parseSignInDomains,
  SignInDomainsSchema,
} from "./index.ts";

describe("ProjectIdentitySchema", () => {
  it("requires an https issuer and defaults required to false", () => {
    const parsed = ProjectIdentitySchema.parse({ issuer: "https://id.test/realm" });
    expect(parsed).toEqual({ issuer: "https://id.test/realm", required: false });
    expect(ProjectIdentitySchema.safeParse({ issuer: "not a url" }).success).toBe(false);
    expect(ProjectIdentitySchema.safeParse({}).success).toBe(false);
  });

  it("accepts an inline key set and a staff claim", () => {
    const parsed = ProjectIdentitySchema.parse({
      issuer: "https://id.test",
      jwks: { keys: [{ kty: "EC", crv: "P-256", x: "a", y: "b" }] },
      staffClaim: { path: "realm_access.roles", value: "support" },
      required: true,
    });
    expect(parsed.jwks?.keys).toHaveLength(1);
    expect(parsed.staffClaim).toEqual({ path: "realm_access.roles", value: "support" });
  });
});

describe("ConversationContextSchema", () => {
  it("takes identifier keys with an id and an optional name, at most eight", () => {
    expect(
      ConversationContextSchema.parse({ site: { id: "42", name: "Shop" }, account: { id: "7" } }),
    ).toEqual({
      site: { id: "42", name: "Shop" },
      account: { id: "7" },
    });
    expect(ConversationContextSchema.safeParse({ "bad key": { id: "1" } }).success).toBe(false);
    expect(ConversationContextSchema.safeParse({ site: { name: "no id" } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, { id: "1" }]));
    expect(ConversationContextSchema.safeParse(many).success).toBe(false);
  });

  it("stays optional on ask and list requests", () => {
    expect(
      AskRequestSchema.safeParse({ projectKey: "pk", sessionId: "s", message: "q" }).success,
    ).toBe(true);
    expect(
      AskRequestSchema.safeParse({
        projectKey: "pk",
        sessionId: "s",
        message: "q",
        context: { site: { id: "42" } },
      }).success,
    ).toBe(true);
    expect(
      ConversationListRequestSchema.safeParse({ projectKey: "pk", sessionId: "s" }).success,
    ).toBe(true);
    expect(
      ConversationListRequestSchema.safeParse({ projectKey: "pk", sessionId: "s", limit: 51 })
        .success,
    ).toBe(false);
    expect(
      ConversationListRequestSchema.safeParse({
        projectKey: "pk",
        sessionId: "s",
        scope: { key: "site", id: "42" },
        limit: 50,
      }).success,
    ).toBe(true);
  });
});

describe("ConversationRenameRequestSchema", () => {
  it("trims and bounds the title", () => {
    expect(
      ConversationRenameRequestSchema.parse({
        projectKey: "pk",
        sessionId: "s",
        conversationId: "c",
        title: "  Exports  ",
      }).title,
    ).toBe("Exports");
    expect(
      ConversationRenameRequestSchema.safeParse({
        projectKey: "pk",
        sessionId: "s",
        conversationId: "c",
        title: "   ",
      }).success,
    ).toBe(false);
    expect(
      ConversationRenameRequestSchema.safeParse({
        projectKey: "pk",
        sessionId: "s",
        conversationId: "c",
        title: "x".repeat(121),
      }).success,
    ).toBe(false);
  });
});

describe("SignInDomainsSchema", () => {
  it("keeps bare hostnames lower-cased and unique, refuses junk, caps the list", () => {
    expect(
      SignInDomainsSchema.parse([" Example.com ", "example.com", "sub.example.co.uk"]),
    ).toEqual(["example.com", "sub.example.co.uk"]);
    for (const bad of ["not a domain", "http://example.com", "@example.com", "example", "-x.com"]) {
      expect(SignInDomainsSchema.safeParse([bad]).success, bad).toBe(false);
    }
    expect(
      SignInDomainsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `d${i}.com`)).success,
    ).toBe(false);
  });

  it("parses a textarea and names the offending entry", () => {
    expect(parseSignInDomains("example.com, other.org\n\n")).toEqual({
      ok: true,
      domains: ["example.com", "other.org"],
    });
    expect(parseSignInDomains("")).toEqual({ ok: true, domains: [] });
    expect(parseSignInDomains("example.com bad!")).toMatchObject({
      ok: false,
      reason: expect.stringContaining('"bad!"'),
    });
  });
});
