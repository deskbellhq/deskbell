import { expect, test } from "@playwright/test";

/**
 * Settings › Data retention (spec: conversation-retention). The purge itself
 * is the worker's, unit-tested there; what the browser has to prove is that
 * the count the page names is the seed's (threads 1–100 days old, three of
 * them past 30), that a window which removes something is confirmed first
 * and can be declined, that the value survives a reload, and that keeping
 * everything saves without a dialog. No worker runs here, so a saved window
 * never touches the shared seed — the last step still puts it back.
 */
test.describe("Settings › Data retention", () => {
  test("names the count, confirms, persists, and goes back to keep forever", async ({ page }) => {
    await page.goto("/settings/retention");
    await expect(page.getByRole("heading", { name: "Data retention", level: 1 })).toBeVisible();

    const window = page.getByLabel("Keep conversations for");
    await expect(window).toHaveValue("0");
    await expect(page.getByText("Nothing is removed.")).toBeVisible();

    await window.selectOption("30");
    await expect(page.getByText(/3 conversations are older than 30 days/)).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Remove 3 conversations?");
    await page.getByRole("button", { name: "Keep them" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Saved.")).toHaveCount(0);

    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Remove and keep 30 days" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Keep conversations for")).toHaveValue("30");

    await page.getByLabel("Keep conversations for").selectOption("custom");
    await page.getByLabel("Custom number of days").fill("7");
    await expect(page.getByText(/7 conversations are older than 7 days/)).toBeVisible();

    await page.getByLabel("Keep conversations for").selectOption("0");
    await expect(page.getByText("Nothing is removed.")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Keep conversations for")).toHaveValue("0");
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/retention");
    await expect(page.getByRole("link", { name: "Data retention", exact: true })).toBeVisible();
  });
});
