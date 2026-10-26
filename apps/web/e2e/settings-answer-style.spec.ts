import { expect, test } from "@playwright/test";

/**
 * Settings › Answer style (spec: answer-style). What the paragraph does to an
 * answer is the engine's, covered by its own tests; what the browser has to
 * prove is that a style survives a save and a reload, and that clearing it
 * really stores nothing.
 */
test.describe("Settings › Answer style", () => {
  test("saves a style, and clears it back to the default voice", async ({ page }) => {
    await page.goto("/settings/answer-style");
    await expect(page.getByRole("heading", { name: "Answer style", level: 1 })).toBeVisible();

    const style = page.getByLabel("Style instruction");
    await expect(style).toHaveValue("");

    await style.fill("  Answer in one sentence. ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(style).toHaveValue("Answer in one sentence.");

    await style.fill("");
    await page.getByRole("button", { name: "Save" }).click();
    // The field description also says "default voice"; the status line is what proves the save.
    await expect(page.getByText("answers in the default voice")).toBeVisible();
    await page.reload();
    await expect(style).toHaveValue("");
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/answer-style");
    await expect(page.getByRole("link", { name: "Answer style", exact: true })).toBeVisible();
  });
});
