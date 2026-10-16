import { expect, test } from "@playwright/test";

/**
 * Settings › Notifications (spec: project-notifications). Nothing is
 * delivered from this page, so the suite needs no receiver: it checks that
 * a saved target comes back masked and that the input never carries it.
 */
test.describe("Settings › Notifications", () => {
  test("saves a Slack target and shows it masked", async ({ page }) => {
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await page.getByLabel("Webhook URL").fill("https://hooks.slack.com/services/T0/B0/e2e-secret");
    await page.getByRole("button", { name: "Start from the default" }).click();
    const template = page.getByLabel("Message for negative feedback");
    await expect(template).toHaveValue(/\{question\}/);
    await template.fill("*{project.name}*: {question}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("slack-masked")).toHaveText("https://hooks.slack.com/…");
    await expect(page.getByLabel("Webhook URL")).toHaveValue("");
    await expect(page.getByLabel("Message for negative feedback")).toHaveValue(
      "*{project.name}*: {question}",
    );
    await expect(page.locator("body")).not.toContainText("e2e-secret");
  });

  test("a first webhook target reveals its signing secret once", async ({ page }) => {
    await page.goto("/settings/notifications");
    // The projects share one database and run in sequence: clear what an
    // earlier project left, so this is a first target again.
    if (await page.getByTestId("webhook-masked").isVisible()) {
      await page.getByLabel("Remove this channel").last().check();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("webhook-masked")).toHaveCount(0);
    }
    await page.getByLabel("Endpoint URL").fill("https://receiver.example/deskbell");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("whsec_");
    await page.reload();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByTestId("webhook-masked")).toHaveText("https://receiver.example/…");
  });

  test("the settings navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/settings/notifications");
    await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  });
});
