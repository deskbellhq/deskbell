import { createServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

/**
 * Actions (spec: mcp-actions, actions-settings-ui) against a real
 * MCP server the spec runs on a loopback port: attaching a server through
 * the dialog lands on its page with its tools discovered, the credential
 * comes back masked, a policy saves the moment it is set and survives a
 * reload, and removing the server behind its confirmation returns to an
 * empty list.
 */

const PORT = 8766;
const seen: string[] = [];

function serve(): Server {
  return createServer(async (req, res) => {
    seen.push(String(req.headers.authorization ?? ""));
    const server = new McpServer({ name: "e2e-shop", version: "0.1.0" });
    server.registerTool(
      "order_status",
      {
        title: "Order status",
        description: "Looks up an order by its id.",
        inputSchema: { id: z.string() },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => ({ content: [{ type: "text", text: `order ${id}: shipped` }] }),
    );
    server.registerTool(
      "cancel_order",
      { description: "Cancels an order.", inputSchema: { id: z.string() } },
      async () => ({ content: [{ type: "text", text: "cancelled" }] }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    res.on("close", () => void transport.close());
  });
}

/** Remove the server from its page: the menu, then the confirmation. */
async function removeServer(page: Page) {
  await page.getByRole("button", { name: "Server actions" }).click();
  await page.getByRole("menuitem", { name: "Remove server" }).click();
  await page.getByRole("button", { name: "Remove server" }).click();
  await expect(page).toHaveURL(/\/actions\/servers$/);
  await expect(page.getByTestId("server-e2e-shop")).toHaveCount(0);
}

test.describe("Actions › Servers", () => {
  let server: Server;
  test.beforeAll(async () => {
    server = serve();
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  });
  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("attaches a server, lists its tools, masks the credential, keeps a policy", async ({
    page,
  }) => {
    await page.goto("/actions/servers");
    await expect(page.getByRole("tab", { name: "Servers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The projects share one database and run in sequence: a server left by
    // an earlier project is removed first so this is an attach again.
    const existing = page.getByTestId("server-e2e-shop");
    if (await existing.isVisible()) {
      await existing.click();
      await removeServer(page);
    }

    await page.getByRole("button", { name: "Attach server" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("E2E Shop");
    await dialog.getByLabel("URL", { exact: true }).fill(`http://127.0.0.1:${PORT}/mcp`);
    await dialog.getByLabel("Credential", { exact: true }).click();
    await page.getByRole("option", { name: "Bearer token" }).click();
    await dialog.getByLabel("Token", { exact: true }).fill("e2e-token-secret");
    await dialog.getByRole("button", { name: "Advanced" }).click();
    await dialog.getByLabel("Id", { exact: true }).fill("e2e-shop");
    await dialog.getByRole("button", { name: "Attach" }).click();

    // The attach opens the server's page with its tools already discovered.
    await expect(page).toHaveURL(/\/actions\/servers\/srv_/);
    const saved = page.getByTestId("server-e2e-shop");
    await expect(saved.getByRole("heading", { name: "E2E Shop", level: 1 })).toBeVisible();
    await expect(saved.getByText("Connected")).toBeVisible();
    await expect(saved.getByText("Looks up an order by its id.")).toBeVisible();
    await expect(saved.getByRole("heading", { name: "Lookups" })).toBeVisible();
    await expect(saved.getByRole("heading", { name: "Actions", level: 3 })).toBeVisible();
    await expect(saved.getByText("Every tool is off")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("e2e-token-secret");
    await expect(saved.getByTestId(/-secret-masked$/)).toBeVisible();
    expect(seen.some((h) => h === "Bearer e2e-token-secret")).toBe(true);

    // A policy saves as soon as it is chosen.
    const orderStatus = saved.getByRole("radiogroup", { name: "Policy for order_status" });
    await orderStatus.getByRole("radio", { name: "Allowed" }).click();
    await expect(page.getByText("order_status: Allowed")).toBeVisible();
    await expect(page.getByText("Applies to the next question.", { exact: true })).toBeVisible();
    // A label saves when the field is left.
    await saved.getByLabel("Label for order_status").fill("Look up your order");
    await saved.getByLabel("Label for order_status").press("Enter");
    await expect(page.getByText("order_status: shown as “Look up your order”")).toBeVisible();
    await page.reload();
    const again = page.getByTestId("server-e2e-shop");
    await expect(again.getByLabel("Label for order_status")).toHaveValue("Look up your order");
    await expect(again.getByLabel("Label for cancel_order")).toHaveValue("");
    await expect(
      again.getByRole("radiogroup", { name: "Policy for order_status" }).getByRole("radio", {
        name: "Allowed",
      }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      again.getByRole("radiogroup", { name: "Policy for cancel_order" }).getByRole("radio", {
        name: "Off",
      }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(again.getByText("Suggested: Needs confirmation")).toBeVisible();
    // One policy set means the list summarises it and the callout is gone.
    await expect(again.getByText("Every tool is off")).toHaveCount(0);
    await page.getByRole("tab", { name: "Servers" }).click();
    await expect(page.getByTestId("server-e2e-shop")).toContainText("2 tools");

    await page.getByTestId("server-e2e-shop").click();
    await removeServer(page);
    // The browser suite seeds a server of its own for the actions log, so
    // the list is not empty afterwards — only this one is gone.
    await expect(page.getByTestId("server-e2e-shop")).toHaveCount(0);
  });

  test("attaches a server that takes the visitor's own token, listing with a one-time token (spec: visitor-token-actions)", async ({
    page,
  }) => {
    await page.goto("/actions/servers");
    const existing = page.getByTestId("server-e2e-visitor");
    if (await existing.isVisible()) {
      await existing.click();
      await removeServer(page);
    }
    seen.length = 0;

    await page.getByRole("button", { name: "Attach server" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("E2E Visitor");
    await dialog.getByLabel("URL", { exact: true }).fill(`http://127.0.0.1:${PORT}/mcp`);
    await dialog.getByRole("button", { name: "Advanced" }).click();
    await dialog.getByLabel("Id", { exact: true }).fill("e2e-visitor");
    await dialog.getByLabel("Visitor identity", { exact: true }).click();
    await page.getByRole("option", { name: "Visitor's own token" }).click();
    // Forwarding, no exchange client: the exchange fields stay off.
    await expect(dialog.getByLabel("Audience", { exact: true })).toBeDisabled();
    await dialog.getByLabel("Token for listing tools").fill("e2e-listing-token");
    await dialog.getByRole("button", { name: "Attach" }).click();

    await expect(page).toHaveURL(/\/actions\/servers\/srv_/);
    const saved = page.getByTestId("server-e2e-visitor");
    await expect(saved.getByText("Connected")).toBeVisible();
    await expect(saved.getByText("Looks up an order by its id.")).toBeVisible();
    // The pasted token listed the tools and went nowhere else.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h === "Bearer e2e-listing-token")).toBe(true);
    await expect(page.locator("body")).not.toContainText("e2e-listing-token");
    await expect(saved.getByLabel("Visitor identity", { exact: true })).toContainText(
      "Visitor's own token",
    );

    // Refresh asks for a token rather than trying the instance alone.
    await page.getByRole("button", { name: "Refresh tools" }).click();
    const ask = page.getByRole("dialog", { name: "List tools with a visitor's token" });
    await expect(ask).toBeVisible();
    await ask.getByLabel("Token", { exact: true }).fill("e2e-second-token");
    await ask.getByRole("button", { name: "Refresh tools" }).click();
    await expect(page.getByText("2 tools found")).toBeVisible();
    expect(seen.some((h) => h === "Bearer e2e-second-token")).toBe(true);

    await removeServer(page);
  });

  test("the main navigation lists it, and the old settings link still lands", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/actions");
    await expect(page).toHaveURL(/\/actions$/);
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByRole("link", { name: "Actions", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Servers" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Log" })).toBeVisible();
  });
});
