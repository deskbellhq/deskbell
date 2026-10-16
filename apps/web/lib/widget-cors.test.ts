import { describe, expect, it } from "vitest";

import { readAbuseConfig } from "./abuse/config";
import { checkOrigin, corsHeaders, preflight } from "./widget-cors";

describe("preflight", () => {
  it("lets the browser send the content type and the end-user bearer", () => {
    const res = preflight(
      new Request("https://d.test/api/v1/ask", {
        method: "OPTIONS",
        headers: { origin: "https://site.test" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, authorization");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://site.test");
  });
});

const dev = readAbuseConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
const prod = readAbuseConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
const prodOpen = readAbuseConfig({
  NODE_ENV: "production",
  DESKBELL_ALLOW_ANY_ORIGIN: "true",
} as NodeJS.ProcessEnv);

const SITE = "https://docs.example.com";
const SELF = "https://deskbell.acme.example";
const SELF_HOST = "deskbell.acme.example";

/** Existing cases assert third-party behaviour; they get no self host. */
const NONE: string[] = [];

describe("checkOrigin with an allowlist configured", () => {
  const allowed = [SITE];

  it("allows a listed origin", () => {
    expect(
      checkOrigin({
        origin: SITE,
        allowedOrigins: allowed,
        method: "POST",
        selfHosts: NONE,
        config: prod,
      }),
    ).toEqual({ allowed: true, openToAll: false });
  });

  it("refuses an unlisted origin", () => {
    const verdict = checkOrigin({
      origin: "https://evil.example",
      allowedOrigins: allowed,
      method: "POST",
      selfHosts: NONE,
      config: prod,
    });
    expect(verdict).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("refuses the opaque null origin", () => {
    const verdict = checkOrigin({
      origin: "null",
      allowedOrigins: allowed,
      method: "POST",
      selfHosts: NONE,
      config: dev,
    });
    expect(verdict).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("refuses a POST with no Origin at all — browsers always send one", () => {
    const verdict = checkOrigin({
      origin: null,
      allowedOrigins: allowed,
      method: "POST",
      selfHosts: NONE,
      config: dev,
    });
    expect(verdict).toEqual({ allowed: false, reason: "missing_origin" });
  });

  it("allows a same-origin GET, which carries no Origin header", () => {
    // Regression: refusing this broke every self-hoster serving the widget from
    // the same domain as the API the moment they locked down origins.
    const verdict = checkOrigin({
      origin: null,
      allowedOrigins: allowed,
      method: "GET",
      selfHosts: NONE,
      config: prod,
    });
    expect(verdict).toEqual({ allowed: true, openToAll: false });
  });
});

describe("checkOrigin with an empty allowlist", () => {
  it("answers any origin in development", () => {
    expect(
      checkOrigin({
        origin: SITE,
        allowedOrigins: [],
        method: "POST",
        selfHosts: NONE,
        config: dev,
      }),
    ).toEqual({
      allowed: true,
      openToAll: true,
    });
  });

  it("refuses in production — an unconfigured project is a public endpoint", () => {
    expect(
      checkOrigin({
        origin: SITE,
        allowedOrigins: [],
        method: "POST",
        selfHosts: NONE,
        config: prod,
      }),
    ).toEqual({
      allowed: false,
      reason: "unconfigured",
    });
  });

  it("answers in production when the operator opts in explicitly", () => {
    expect(
      checkOrigin({
        origin: SITE,
        allowedOrigins: [],
        method: "POST",
        selfHosts: NONE,
        config: prodOpen,
      }),
    ).toEqual({ allowed: true, openToAll: true });
  });

  it("still allows a same-origin GET, so the dashboard can read its own config", () => {
    // GET /api/v1/config on a fresh install, which is what the Appearance
    // preview fetches. The sibling case above covers a same-origin GET with an
    // allowlist configured; this one is empty, and it is the ordering that
    // makes it pass — the no-Origin return sits ABOVE the allowlist check, not
    // inside it, where it used to be. Moving it back reads as a tidy-up, keeps
    // every other test green, and silently returns the Appearance preview to
    // rendering defaults over saved config on every fresh production install.
    expect(
      checkOrigin({
        origin: null,
        allowedOrigins: [],
        method: "GET",
        selfHosts: NONE,
        config: prod,
      }),
    ).toEqual({ allowed: true, openToAll: false });
  });
});

describe("the deployment's own origin", () => {
  // Found in review and reproduced against a production build: the dashboard
  // dogfoods the widget, so the guard was fencing the operator out of their
  // own instance.
  const self = [SELF_HOST];

  it("passes on an empty allowlist in production — the fresh docker-compose case", () => {
    // Without this the operator's first action on a new install, "ask it
    // something" in the onboarding checklist, 403s.
    expect(
      checkOrigin({
        origin: SELF,
        allowedOrigins: [],
        method: "POST",
        selfHosts: self,
        config: prod,
      }),
    ).toEqual({ allowed: true, openToAll: false });
  });

  it("passes when the allowlist names only the customer's site", () => {
    // The bug that made this more than a first-run problem: configuring the
    // allowlist correctly did NOT unbreak the dashboard, because the operator's
    // dashboard is not the customer's site.
    expect(
      checkOrigin({
        origin: SELF,
        allowedOrigins: ["https://docs.acme.example"],
        method: "POST",
        selfHosts: self,
        config: prod,
      }),
    ).toEqual({ allowed: true, openToAll: false });
  });

  it("still refuses a third party when only the self origin is known", () => {
    expect(
      checkOrigin({
        origin: "https://evil.example",
        allowedOrigins: [],
        method: "POST",
        selfHosts: self,
        config: prod,
      }),
    ).toEqual({ allowed: false, reason: "unconfigured" });
  });

  it("does not let the opaque null origin ride in on the exemption", () => {
    expect(
      checkOrigin({
        origin: "null",
        allowedOrigins: [],
        method: "POST",
        selfHosts: self,
        config: prod,
      }),
    ).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("matches on host, so TLS termination that hides the scheme still passes", () => {
    // Next reports its own socket scheme (http) behind a TLS-terminating proxy,
    // while the browser sends https. Comparing full origins would 403 here.
    expect(
      checkOrigin({
        origin: "https://deskbell.acme.example",
        allowedOrigins: [],
        method: "POST",
        selfHosts: ["deskbell.acme.example"],
        config: prod,
      }),
    ).toEqual({ allowed: true, openToAll: false });
  });

  it("does not match a lookalike host", () => {
    expect(
      checkOrigin({
        origin: "https://deskbell.acme.example.evil.test",
        allowedOrigins: [],
        method: "POST",
        selfHosts: ["deskbell.acme.example"],
        config: prod,
      }),
    ).toEqual({ allowed: false, reason: "unconfigured" });
  });

  it("grants nothing when no self host could be derived", () => {
    expect(
      checkOrigin({
        origin: SELF,
        allowedOrigins: [],
        method: "POST",
        selfHosts: NONE,
        config: prod,
      }),
    ).toEqual({ allowed: false, reason: "unconfigured" });
  });
});

describe("corsHeaders", () => {
  it("echoes an allowed origin and varies on it", () => {
    expect(corsHeaders(SITE, { allowed: true, openToAll: false })).toEqual({
      "access-control-allow-origin": SITE,
      vary: "Origin",
    });
  });

  it("opens up only when the verdict says so", () => {
    expect(corsHeaders(SITE, { allowed: true, openToAll: true })).toEqual({
      "access-control-allow-origin": "*",
    });
  });

  it("grants nothing to a refused origin", () => {
    // Asserting allow-origin for a site we just refused would be a lie the
    // browser then acts on.
    expect(corsHeaders(SITE, { allowed: false, reason: "not_allowed" })).toEqual({});
  });

  it("grants nothing on a same-origin request, which needs no grant", () => {
    expect(corsHeaders(null, { allowed: true, openToAll: false })).toEqual({});
  });
});
