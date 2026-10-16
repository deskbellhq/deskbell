import { expect, test } from "@playwright/test";

/**
 * The settings page that used to be called Deploy (spec:
 * overview-getting-started). The old URL is gone, not redirected: nothing
 * public ever linked to it.
 */
test.describe("Settings › Install", () => {
  test("the page says Install and carries the snippet", async ({ page }) => {
    await page.goto("/settings/install");
    await expect(page.getByRole("heading", { name: "Install", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy snippet" }).first()).toBeVisible();
  });

  test("the settings navigation names it Install", async ({ page }, testInfo) => {
    // The settings sub-sidebar is a sheet at phone width; the desktop project
    // is where the label is on screen.
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/install");
    await expect(page.getByRole("link", { name: "Install", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Deploy", exact: true })).toHaveCount(0);
  });
});
