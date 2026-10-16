import { describe, expect, it } from "vitest";

import { readAuthConfig } from "./config";

const env = (init: Record<string, string>) => init as NodeJS.ProcessEnv;

describe("readAuthConfig", () => {
  it("flags the .env.example placeholder — shipping it would sign forgeable sessions", () => {
    const cfg = readAuthConfig(env({ BETTER_AUTH_SECRET: "change-me" }));
    expect(cfg.secretIsPlaceholder).toBe(true);
  });

  it("flags an unset or blank secret", () => {
    expect(readAuthConfig(env({})).secretIsPlaceholder).toBe(true);
    expect(readAuthConfig(env({ BETTER_AUTH_SECRET: "   " })).secretIsPlaceholder).toBe(true);
  });

  it("accepts a real secret verbatim", () => {
    const cfg = readAuthConfig(env({ BETTER_AUTH_SECRET: "s3cret-value" }));
    expect(cfg.secret).toBe("s3cret-value");
    expect(cfg.secretIsPlaceholder).toBe(false);
  });

  it("never returns an empty secret — better-auth would throw at startup", () => {
    expect(readAuthConfig(env({})).secret).not.toBe("");
  });

  it("defaults the base URL to localhost and trims a configured one", () => {
    expect(readAuthConfig(env({})).baseURL).toBe("http://localhost:3000");
    expect(readAuthConfig(env({ BETTER_AUTH_URL: " https://support.example.com " })).baseURL).toBe(
      "https://support.example.com",
    );
  });

  it("reads production off NODE_ENV", () => {
    expect(readAuthConfig(env({ NODE_ENV: "production" })).isProduction).toBe(true);
    expect(readAuthConfig(env({})).isProduction).toBe(false);
  });
});

describe("readAuthConfig — Google sign-in", () => {
  it("is on only with both variables, trimmed", () => {
    const cfg = readAuthConfig(env({ GOOGLE_CLIENT_ID: " id.apps ", GOOGLE_CLIENT_SECRET: "s " }));
    expect(cfg.google).toEqual({ clientId: "id.apps", clientSecret: "s" });
    expect(cfg.googleHalfConfigured).toBe(false);
  });

  it("refuses half a configuration and is off by default", () => {
    const half = readAuthConfig(env({ GOOGLE_CLIENT_ID: "id.apps" }));
    expect(half.google).toBeNull();
    expect(half.googleHalfConfigured).toBe(true);
    const off = readAuthConfig(env({}));
    expect(off.google).toBeNull();
    expect(off.googleHalfConfigured).toBe(false);
  });
});
