import { describe, expect, it } from "vitest";

import type { ServerView, ToolView } from "./settings";
import { policyCount, toolTableRows } from "./tools-table";
import { usageKey } from "./usage-query";

const tool = (name: string, over: Partial<ToolView> = {}): ToolView => ({
  name,
  title: name,
  description: "",
  readOnly: false,
  destructive: false,
  openWorld: false,
  policy: "off",
  suggested: "confirm",
  label: "",
  ...over,
});

const server = (id: string, tools: ToolView[], enabled = true): ServerView => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  url: "https://x.test/mcp",
  transport: "http",
  authKind: "none",
  authHeaderName: "",
  secretMasked: null,
  identity: "none",
  exchangeClientId: "",
  exchangeSecretMasked: null,
  exchangeAudience: "",
  exchangeScope: "",
  enabled,
  status: "ok",
  lastError: null,
  serverInfo: null,
  toolsFetchedAt: null,
  tools,
});

describe("tools table (spec: actions-ia)", () => {
  it("lists every tool in server order, lookups first, with its usage", () => {
    const usage = new Map([
      [usageKey("a", "cancel"), { calls: 2, failed: 1, medianMs: 300, lastAt: null }],
    ]);
    const rows = toolTableRows(
      [server("a", [tool("cancel"), tool("status", { readOnly: true })]), server("b", [tool("x")])],
      usage,
    );
    expect(rows.map((r) => `${r.server.id}/${r.tool.name}`)).toEqual([
      "a/status",
      "a/cancel",
      "b/x",
    ]);
    expect(rows[1]?.usage).toEqual({ calls: 2, failed: 1, medianMs: 300, lastAt: null });
    expect(rows[0]?.usage).toBeNull();
  });

  it("counts tools that are on, on servers that are on", () => {
    const rows = toolTableRows(
      [
        server("a", [tool("x", { policy: "allow" }), tool("y")]),
        server("b", [tool("z", { policy: "confirm" })], false),
      ],
      new Map(),
    );
    expect(policyCount(rows)).toEqual({ on: 1, total: 3 });
  });
});
