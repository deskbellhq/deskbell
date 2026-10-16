import { ACTION_IDENTITY_HEADER } from "@deskbell/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type ActionServerConnection,
  connectActionServer,
  discoverActionServer,
  normalizeToolResult,
} from "./mcp";

/**
 * A real MCP server, in process: the SDK's web-standard transport answers
 * `fetch` calls directly, so the client under test speaks the actual
 * protocol without a port. What is pinned: discovery keeps the annotations,
 * calls carry the credential and the identity header, and a result comes
 * back in the shape the engine expects.
 */

function makeServer() {
  const server = new McpServer({ name: "shop", version: "1.2.3" });
  server.registerTool(
    "order_status",
    {
      title: "Order status",
      description: "Looks up an order by id",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ({ content: [{ type: "text", text: `order ${id} shipped` }] }),
  );
  server.registerTool(
    "cancel_order",
    { description: "Cancels an order", inputSchema: { id: z.string() } },
    async () => ({ content: [{ type: "text", text: "no" }], isError: true }),
  );
  return server;
}

async function fakeServer() {
  const seen: Array<Record<string, string>> = [];
  // Stateless mode: one server and transport per request, as a serverless
  // MCP server would have.
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push(Object.fromEntries(request.headers.entries()));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = makeServer();
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
    }
  };
  return { fetchImpl, seen };
}

const connection: ActionServerConnection = {
  id: "srv_1",
  slug: "shop",
  url: "https://shop.example.com/mcp",
  transport: "http",
  authKind: "bearer",
  authHeaderName: null,
  authSecret: "tok_123",
  identity: "signed",
  exchangeClientId: null,
  exchangeClientSecret: null,
  exchangeAudience: null,
  exchangeScope: null,
  initializeResult: null,
};

describe("discoverActionServer", () => {
  it("lists the tools with their annotations and the server's identity", async () => {
    const { fetchImpl, seen } = await fakeServer();
    const discovery = await discoverActionServer(connection, { fetch: fetchImpl });
    expect(discovery.serverInfo).toMatchObject({ name: "shop", version: "1.2.3" });
    expect(discovery.tools.map((t) => t.name).sort()).toEqual(["cancel_order", "order_status"]);
    const status = discovery.tools.find((t) => t.name === "order_status");
    expect(status?.annotations?.readOnlyHint).toBe(true);
    expect(status?.title).toBe("Order status");
    expect(status?.inputSchema).toMatchObject({ type: "object" });
    expect(typeof discovery.initializeResult.protocolVersion).toBe("string");
    // The credential rode on every request.
    expect(seen.every((h) => h.authorization === "Bearer tok_123")).toBe(true);
  });
});

describe("connectActionServer", () => {
  it("reuses the stored initialize result and sends the identity header on a call", async () => {
    const { fetchImpl, seen } = await fakeServer();
    const discovery = await discoverActionServer(connection, { fetch: fetchImpl });
    seen.length = 0;
    const client = await connectActionServer(
      { ...connection, initializeResult: discovery.initializeResult },
      { fetch: fetchImpl, identityToken: "eyJ.visitor" },
    );
    try {
      const result = await client.callTool({ name: "order_status", arguments: { id: "42" } });
      expect(normalizeToolResult(result)).toEqual({ output: "order 42 shipped" });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((h) => h[ACTION_IDENTITY_HEADER] === "eyJ.visitor")).toBe(true);
      const failed = await client.callTool({ name: "cancel_order", arguments: { id: "42" } });
      expect(normalizeToolResult(failed)).toEqual({ output: null, error: "no" });
    } finally {
      await client.close();
    }
  });

  it("sends a visitor's token as the bearer in place of the credential (spec: visitor-token-actions)", async () => {
    const { fetchImpl, seen } = await fakeServer();
    const visitorServer: ActionServerConnection = {
      ...connection,
      authKind: "header",
      authHeaderName: "X-Api-Key",
      authSecret: "key_9",
      identity: "visitor",
    };
    const discovery = await discoverActionServer(visitorServer, {
      fetch: fetchImpl,
      bearerToken: "one-time",
    });
    expect(discovery.tools).toHaveLength(2);
    expect(seen.every((h) => h.authorization === "Bearer one-time")).toBe(true);
    seen.length = 0;
    const client = await connectActionServer(
      { ...visitorServer, initializeResult: discovery.initializeResult },
      { fetch: fetchImpl, bearerToken: "eyJ.exchanged" },
    );
    try {
      await client.callTool({ name: "order_status", arguments: { id: "1" } });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((h) => h.authorization === "Bearer eyJ.exchanged")).toBe(true);
      expect(seen.every((h) => h["x-api-key"] === "key_9")).toBe(true);
      expect(seen.every((h) => !(ACTION_IDENTITY_HEADER in h))).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("refuses a URL that fails the webhook checks", async () => {
    await expect(
      connectActionServer({ ...connection, url: "http://10.0.0.1/mcp" }),
    ).rejects.toThrow(/URL/);
  });
});

describe("normalizeToolResult", () => {
  it("prefers structured content, joins several text blocks, keeps one plain", () => {
    expect(normalizeToolResult({ content: [], structuredContent: { a: 1 } })).toEqual({
      output: { a: 1 },
    });
    expect(
      normalizeToolResult({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toEqual({ output: "a\nb" });
    expect(normalizeToolResult({ content: [{ type: "image", data: "…" }] })).toEqual({
      output: [{ type: "image", data: "…" }],
    });
  });
});
