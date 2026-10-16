import { expect, test } from "@playwright/test";

import { SEED, WIDGET } from "./seed";

const { calls, server } = SEED.actions;

/**
 * The actions log (spec: actions-log): the seeded calls in order, the status
 * filter, the drawer with the full record, the CSV, and the way in from a
 * transcript's call row.
 */
test.describe("actions log", () => {
  test("lists calls newest first with their outcome", async ({ page }) => {
    await page.goto("/actions/log");
    await expect(page.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    const rows = page.getByRole("table").getByRole("row");
    // Header, then four calls: the latest seeded minute first.
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1)).toContainText("Cancel your order");
    await expect(rows.nth(1)).toContainText("Declined");
    await expect(rows.nth(4)).toContainText("Look up your order");
    await expect(rows.nth(4)).toContainText("Done");
    await expect(rows.nth(4)).toContainText("1.2 s");
    await expect(rows.nth(3)).toContainText("Failed");
    await expect(rows.nth(3)).toContainText("30 s");
    await expect(page.getByTestId(`call-${calls.done}`)).toContainText(server.name);
    await expect(page.getByTestId(`call-${calls.done}`)).toContainText(WIDGET.visitors.one.name);
    await expect(page.getByTestId(`call-${calls.done}`)).toContainText("Export settings?");
  });

  test("narrows by status and by tool, and clears", async ({ page }) => {
    await page.goto("/actions/log");
    await page
      .getByRole("navigation", { name: "Status" })
      .getByRole("link", { name: "Failed" })
      .click();
    await expect(page).toHaveURL(/status=failed/);
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
    await expect(page.getByTestId(`call-${calls.failed}`)).toBeVisible();

    await page.getByRole("combobox", { name: "Tool" }).click();
    await page.getByRole("option", { name: "Cancel your order" }).click();
    await expect(page).toHaveURL(/tool=cancel_order/);
    await expect(page.getByText("No calls match these filters.")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(5);
  });

  test("opens a call's record with its arguments and result", async ({ page }) => {
    await page.goto("/actions/log");
    await page.getByTestId(`call-${calls.done}`).getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`call=${calls.done}`));
    const drawer = page.getByTestId("call-detail");
    await expect(drawer.getByRole("heading", { name: "Look up your order" })).toBeVisible();
    await expect(drawer.getByText("Done", { exact: true })).toBeVisible();
    await expect(drawer.getByText("1.2 s")).toBeVisible();
    await expect(drawer.getByText(server.name)).toBeVisible();
    await expect(drawer.getByText(WIDGET.visitors.one.name)).toBeVisible();
    await expect(drawer.getByText('"carrier": "DHL"')).toBeVisible();

    // A confirmation shows what the visitor was asked, and the error a failure's reason.
    await page.goto(`/actions/log?call=${calls.awaiting}`);
    await expect(drawer.getByText("Awaiting confirmation")).toBeVisible();
    await expect(drawer.getByText("Order ID")).toBeVisible();
    await expect(drawer.getByText("42", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Expires")).toBeVisible();
    await page.goto(`/actions/log?call=${calls.failed}`);
    await expect(drawer.getByText("upstream timed out after 30 s")).toBeVisible();

    // A foreign id renders the page without a drawer.
    await page.goto("/actions/log?call=act_nope");
    await expect(page.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("call-detail")).toHaveCount(0);
  });

  test("downloads the view as a CSV", async ({ page }) => {
    await page.goto("/actions/log?status=done");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^deskbell-actions-30d-done-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const text = await (await download.createReadStream()).toArray().then((c) => c.join(""));
    const lines = text.trim().split("\n");
    expect(lines[0]).toMatch(/^id,created_at,server,tool,title,status/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`${calls.done},`);
    expect(lines[1]).toContain('"{""id"":""42""}"');
  });

  test("a transcript's call row leads to the record", async ({ page }) => {
    await page.goto(`/conversations/${WIDGET.threads.v1Site.id}`);
    await page.getByRole("link", { name: "Call record: Look up your order" }).first().click();
    await expect(page).toHaveURL(/\/actions\/log\?call=act_e2e_/);
    await expect(page.getByTestId("call-detail")).toBeVisible();
  });
});
