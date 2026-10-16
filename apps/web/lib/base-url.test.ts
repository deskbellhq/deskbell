import { describe, expect, it } from "vitest";

import { originFromHeaders, selfHosts } from "./base-url";

const h = (init: Record<string, string>) => new Headers(init);

describe("originFromHeaders", () => {
  it("prefers the proxy's forwarded host over the internal one", () => {
    expect(
      originFromHeaders(
        h({
          host: "web:3000",
          "x-forwarded-host": "deskbell.acme.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://deskbell.acme.example");
  });

  it("keeps http for loopback, where plaintext is the truth", () => {
    expect(originFromHeaders(h({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originFromHeaders(h({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
  });

  it("assumes https for a real host behind TLS termination", () => {
    // Next populates x-forwarded-proto from its OWN socket when the proxy sends
    // none, so `http` here means "nobody told us" — and an ordinary nginx that
    // forwards Host but not X-Forwarded-Proto lands exactly here while the
    // browser is on https. Rendering http:// would put a mixed-content snippet
    // on the Deploy page that every customer's https page refuses.
    expect(originFromHeaders(h({ host: "deskbell.acme.example" }))).toBe(
      "https://deskbell.acme.example",
    );
    expect(
      originFromHeaders(h({ host: "deskbell.acme.example", "x-forwarded-proto": "http" })),
    ).toBe("https://deskbell.acme.example");
  });

  it("returns null with no host — the guard must not trust a made-up origin", () => {
    expect(originFromHeaders(h({}))).toBeNull();
  });
});

describe("selfHosts", () => {
  it("prefers the forwarded host over the internal one", () => {
    expect(selfHosts(h({ host: "web:3000", "x-forwarded-host": "d.acme.example" }), {})).toEqual([
      "d.acme.example",
    ]);
  });

  it("ignores the scheme entirely", () => {
    // Next always populates x-forwarded-proto — from its own socket when the
    // client sent none — so behind TLS termination it says http while the
    // browser sent https. Comparing schemes would re-create the very bug the
    // exemption exists to fix; see selfHosts() in base-url.ts.
    expect(selfHosts(h({ host: "d.acme.example", "x-forwarded-proto": "http" }), {})).toEqual([
      "d.acme.example",
    ]);
  });

  it("lowercases, since Host casing is not significant", () => {
    expect(selfHosts(h({ host: "D.Acme.Example" }), {})).toEqual(["d.acme.example"]);
  });

  it("adds DESKBELL_PUBLIC_URL's host, for proxies that forward no usable host", () => {
    const got = selfHosts(h({ host: "web:3000" }), {
      DESKBELL_PUBLIC_URL: "https://deskbell.acme.example/dashboard",
    });
    expect(got).toContain("deskbell.acme.example");
  });

  it("ignores a malformed DESKBELL_PUBLIC_URL rather than failing the request", () => {
    expect(selfHosts(h({ host: "localhost:3000" }), { DESKBELL_PUBLIC_URL: "not a url" })).toEqual([
      "localhost:3000",
    ]);
  });

  it("is empty with no host at all, so the exemption grants nothing", () => {
    expect(selfHosts(h({}), {})).toEqual([]);
  });
});
