import { expect, test } from "@playwright/test";

/**
 * Settings › Gaps (spec: gap-cluster-members-and-ignored-terms). The
 * clustering itself is the worker's, measured elsewhere; what the browser
 * has to prove is that the two states the storage distinguishes — the
 * workspace name, and a list of your own — survive a save and a reload.
 */
test.describe("Settings › Gaps", () => {
  test("saves a list of terms, and goes back to the workspace name", async ({ page }) => {
    await page.goto("/settings/gaps");
    await expect(page.getByRole("heading", { name: "Gaps", level: 1 })).toBeVisible();

    const useOrgName = page.getByLabel("Ignore the workspace name");
    const terms = page.getByLabel("Terms to ignore");
    await expect(useOrgName).toBeChecked();
    await expect(terms).toBeDisabled();

    await useOrgName.click();
    await terms.fill("Deskbell\nAcme Corp");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(useOrgName).not.toBeChecked();
    await expect(terms).toHaveValue("Deskbell\nAcme Corp");

    await useOrgName.click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(useOrgName).toBeChecked();
    await expect(terms).toBeDisabled();
  });

  test("offers the rebuild behind a confirmation", async ({ page }) => {
    await page.goto("/settings/gaps");
    await page.getByRole("button", { name: "Re-cluster" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Rebuild every gap cluster?");
    await page.getByRole("button", { name: "Keep them" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/gaps");
    await expect(page.getByRole("link", { name: "Gaps", exact: true })).toBeVisible();
  });
});
