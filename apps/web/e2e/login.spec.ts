import { expect, test } from "@playwright/test";

/**
 * The sign-in page's optional parts (spec: sign-in-with-google). Google is
 * pinned off in the test server's env, so the button is absent; the gate's
 * rejection codes arrive as query parameters and render as sentences.
 */
test.describe("Sign-in page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows no Google button when the provider is not configured", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
  });

  test("explains a rejected sign-in and a missing membership", async ({ page }) => {
    await page.goto("/login?error=signup_closed");
    await expect(page.getByRole("status")).toContainText("invitation-only");
    await page.goto("/login?error=email_domain_not_allowed");
    await expect(page.getByRole("status")).toContainText("domain is not allowed");
    await page.goto("/login?reason=no-membership");
    await expect(page.getByRole("status")).toContainText("not a member");
  });
});

test.describe("Settings › Members", () => {
  test("shows no sign-in domains section when Google is not configured", async ({ page }) => {
    await page.goto("/settings/members");
    await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign-in domains" })).toHaveCount(0);
  });
});
