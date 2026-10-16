import { expect, test as setup } from "@playwright/test";

/**
 * The first account on a fresh instance bootstraps it as owner, so the
 * suite registers through the real form once and every project starts from
 * the saved session. The seed clears accounts before this runs.
 */
export const STORAGE_STATE = "e2e/.auth/user.json";

setup("register the first user and keep the session", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Owner");
  await page.getByLabel("Email").fill("owner@e2e.test");
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-please");
  await page.getByRole("button", { name: /create|sign up|register/i }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: "Gaps", exact: true })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
