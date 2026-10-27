import { expect, test } from "@playwright/test";

import { USAGE } from "./seed";

/**
 * Settings › Topics (spec: question-topics). The labelling is the worker's;
 * what the browser has to prove is that the list survives a save and a
 * reload, that a bad line is named, and that the re-label hides behind a
 * confirmation. The seeded list is restored at the end: the usage suite
 * counts by it.
 */
const SEEDED = USAGE.topics.map((t) => `${t.name}: ${t.description}`).join("\n");

test.describe("Settings › Topics", () => {
  test("saves a list and names a bad line", async ({ page }) => {
    await page.goto("/settings/topics");
    await expect(page.getByRole("heading", { name: "Topics", level: 1 })).toBeVisible();
    const topics = page.getByLabel("Topics", { exact: true });
    await expect(topics).toHaveValue(SEEDED);

    await topics.fill(`${SEEDED}\nOther: the rest`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("is built in")).toBeVisible();

    await topics.fill(`${SEEDED}\nSecurity: SSO, keys and roles`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(topics).toHaveValue(`${SEEDED}\nSecurity: SSO, keys and roles`);

    await topics.fill(SEEDED);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("switches labelling off and on", async ({ page }) => {
    await page.goto("/settings/topics");
    const toggle = page.getByRole("switch", { name: "Label every question" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Labelling is off.")).toBeVisible();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    // Off hides the re-label and tells the Usage page so.
    await expect(page.getByRole("button", { name: "Re-label" })).toHaveCount(0);
    await page.goto("/usage?period=7d&ctx.user_type=internal");
    await expect(page.getByText("Questions are not labelled")).toHaveCount(0);
    await page.goto("/settings/topics");
    await toggle.click();
    await expect(page.getByText("Questions are labelled as they come in.")).toBeVisible();
    await page.reload();
    await expect(toggle).toBeChecked();
  });

  test("offers the re-label behind a confirmation", async ({ page }) => {
    await page.goto("/settings/topics");
    await page.getByRole("button", { name: "Re-label" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Re-label every question?");
    await page.getByRole("button", { name: "Keep them" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/topics");
    await expect(page.getByRole("link", { name: "Topics", exact: true })).toBeVisible();
  });
});
