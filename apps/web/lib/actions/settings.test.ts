import type { ActionToolDefinition } from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import {
  groupTools,
  mergeLabels,
  mergePolicies,
  mergeServerSettings,
  policySummary,
  slugify,
  toolView,
} from "./settings";

const form = {
  name: "Shop API",
  slug: "",
  url: "https://shop.example.com/mcp",
  transport: "http",
  authKind: "bearer",
  authHeaderName: "",
  authSecret: "tok_1",
  identity: "signed",
  exchangeClientId: "",
  exchangeClientSecret: "",
  exchangeAudience: "",
  exchangeScope: "",
  enabled: true,
};
const stored = { authSecret: "old", exchangeClientSecret: null };

describe("mergeServerSettings (spec: mcp-actions)", () => {
  it("derives a slug, validates the URL and keeps the credential", () => {
    const merged = mergeServerSettings(null, form);
    expect(merged).toEqual({
      ok: true,
      server: {
        name: "Shop API",
        slug: "shop-api",
        url: "https://shop.example.com/mcp",
        transport: "http",
        authKind: "bearer",
        authHeaderName: undefined,
        identity: "signed",
        exchangeClientId: undefined,
        exchangeAudience: undefined,
        exchangeScope: undefined,
        enabled: true,
        authSecret: "tok_1",
        exchangeClientSecret: null,
      },
    });
  });

  it("keeps the stored credential when the field is left empty", () => {
    const merged = mergeServerSettings(stored, { ...form, authSecret: "" });
    expect(merged.ok && merged.server.authSecret).toBe("old");
  });

  it("needs a credential the first time, and a header name for header auth", () => {
    expect(mergeServerSettings(null, { ...form, authSecret: "" })).toMatchObject({ ok: false });
    expect(
      mergeServerSettings(null, { ...form, authKind: "header", authSecret: "x" }),
    ).toMatchObject({
      ok: false,
      error: /header/,
    });
    expect(
      mergeServerSettings(null, { ...form, authKind: "header", authHeaderName: "X-Api-Key" }),
    ).toMatchObject({ ok: true, server: { authHeaderName: "X-Api-Key" } });
  });

  it("drops the credential for a server without auth and refuses private URLs", () => {
    expect(mergeServerSettings(stored, { ...form, authKind: "none" })).toMatchObject({
      ok: true,
      server: { authSecret: null },
    });
    expect(mergeServerSettings(null, { ...form, url: "http://192.168.1.4/mcp" })).toMatchObject({
      ok: false,
      error: /URL/,
    });
  });

  it("refuses a bearer credential beside the visitor's token (spec: visitor-token-actions)", () => {
    expect(mergeServerSettings(null, { ...form, identity: "visitor" })).toMatchObject({
      ok: false,
      error: /bearer/,
    });
    expect(
      mergeServerSettings(null, { ...form, identity: "visitor", authKind: "none" }),
    ).toMatchObject({
      ok: true,
      server: { identity: "visitor", authSecret: null, exchangeClientId: undefined },
    });
  });

  it("keeps the exchange client only in visitor mode, with its secret", () => {
    const exchange = {
      ...form,
      identity: "visitor",
      authKind: "none",
      exchangeClientId: "deskbell",
      exchangeAudience: "shop-mcp",
      exchangeScope: "orders:read",
    };
    expect(mergeServerSettings(null, exchange)).toMatchObject({ ok: false, error: /secret/ });
    expect(mergeServerSettings(null, { ...exchange, exchangeClientSecret: "s3" })).toMatchObject({
      ok: true,
      server: {
        exchangeClientId: "deskbell",
        exchangeAudience: "shop-mcp",
        exchangeScope: "orders:read",
        exchangeClientSecret: "s3",
      },
    });
    // An empty secret keeps the stored one; a mode switched away drops the client.
    expect(
      mergeServerSettings({ authSecret: null, exchangeClientSecret: "kept" }, exchange),
    ).toMatchObject({ ok: true, server: { exchangeClientSecret: "kept" } });
    expect(
      mergeServerSettings(null, { ...exchange, identity: "signed", authKind: "bearer" }),
    ).toMatchObject({
      ok: true,
      server: { exchangeClientId: undefined, exchangeClientSecret: null },
    });
  });
});

describe("mergePolicies", () => {
  const tools: ActionToolDefinition[] = [
    { name: "order_status", inputSchema: {} },
    { name: "cancel_order", inputSchema: {} },
  ];
  it("keeps allow and confirm, forgets off and unknown tools", () => {
    expect(
      mergePolicies(tools, { order_status: "allow", cancel_order: "off", gone: "allow" }),
    ).toEqual({ order_status: "allow" });
    expect(mergePolicies(tools, { cancel_order: "confirm" })).toEqual({ cancel_order: "confirm" });
  });
});

describe("mergeLabels (spec: action-presentation)", () => {
  const orderStatus = { name: "order_status", inputSchema: {} };
  const cancelOrder = { name: "cancel_order", inputSchema: {} };
  const tools = [orderStatus, cancelOrder];
  it("keeps non-blank labels for known tools, trims and cuts them", () => {
    expect(
      mergeLabels(tools, {
        order_status: "  Look up your order ",
        cancel_order: "",
        gone: "Nope",
      }),
    ).toEqual({ order_status: "Look up your order" });
    expect(mergeLabels(tools, { cancel_order: "x".repeat(80) })).toEqual({
      cancel_order: "x".repeat(60),
    });
  });
  it("shows the label on the tool view, empty when unset", () => {
    expect(toolView(orderStatus, {}, { order_status: "Look up your order" }).label).toBe(
      "Look up your order",
    );
    expect(toolView(cancelOrder, {}, { order_status: "Look up your order" }).label).toBe("");
    expect(toolView(orderStatus, {}).title).toBe("Order status");
  });
});

describe("slugify", () => {
  it("lowercases, dashes, trims", () => {
    expect(slugify("  My Shop (EU) ")).toBe("my-shop-eu");
  });
});

describe("policySummary and groupTools", () => {
  const tool = (name: string, policy: "off" | "allow" | "confirm", readOnly: boolean) => ({
    name,
    title: name,
    description: "",
    readOnly,
    destructive: false,
    openWorld: false,
    policy,
    suggested: readOnly ? ("allow" as const) : ("confirm" as const),
    label: "",
  });
  it("counts tools per policy", () => {
    expect(
      policySummary([
        tool("a", "allow", true),
        tool("b", "confirm", false),
        tool("c", "off", false),
        tool("d", "off", true),
      ]),
    ).toEqual({ total: 4, allow: 1, confirm: 1, off: 2 });
    expect(policySummary([])).toEqual({ total: 0, allow: 0, confirm: 0, off: 0 });
  });
  it("splits lookups from actions, keeping the server's order within each", () => {
    const { lookups, actions } = groupTools([
      tool("cancel", "off", false),
      tool("status", "off", true),
      tool("refund", "off", false),
      tool("track", "off", true),
    ]);
    expect(lookups.map((t) => t.name)).toEqual(["status", "track"]);
    expect(actions.map((t) => t.name)).toEqual(["cancel", "refund"]);
  });
});
