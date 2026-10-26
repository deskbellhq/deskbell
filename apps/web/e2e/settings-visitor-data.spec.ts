import { expect, test } from "@playwright/test";

/**
 * Settings › Visitor data (spec: own-data-fallback). The rule itself is the
 * engine's, measured in the eval harness; what the browser has to prove is
 * that a reply survives a save and a reload, and that clearing it clears it.
 */
test.describe("Settings › Visitor data", () => {
  test("saves a reply, and clears it", async ({ page }) => {
    await page.goto("/settings/visitor-data");
    await expect(page.getByRole("heading", { name: "Visitor data", level: 1 })).toBeVisible();

    const reply = page.getByLabel("Reply for questions about the visitor's own data");
    await expect(reply).toHaveValue("");

    await reply.fill("I can't see your account from here. Share the setting and I'll help.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(reply).toHaveValue(
      "I can't see your account from here. Share the setting and I'll help.",
    );

    await reply.fill("   ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(reply).toHaveValue("");
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/visitor-data");
    await expect(page.getByRole("link", { name: "Visitor data", exact: true })).toBeVisible();
  });
});
