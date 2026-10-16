import { expect, test } from "@playwright/test";
import { WIDGET } from "../seed";
import { allowHostOrigin, openHost, resetHostState, restoreSeededThreads, signToken } from "./host";

const SIDEBAR = {
  mode: "inline",
  "history-layout": "sidebar",
  "resume-thread": "none",
  "scope-key": "site",
  context: JSON.stringify({ site: { id: "site-1", name: "Shop" } }),
};

test.describe("a signed-in visitor", () => {
  test.beforeAll(allowHostOrigin);
  test.afterAll(resetHostState);
  test.beforeEach(restoreSeededThreads);

  test("sees their own threads, scoped, and can delete one for good", async ({ page }) => {
    const token = await signToken({ sub: WIDGET.visitors.one.subject, name: "Visitor One" });
    await openHost(page, { attrs: SIDEBAR, token, style: "display:block;height:600px" });
    const rail = page.getByRole("complementary", { name: "Conversations" });
    await expect(rail.getByRole("button", { name: /^Export settings/ })).toBeVisible();
    await expect(rail.getByRole("button", { name: /^Billing question/ })).toHaveCount(0);

    await rail.getByRole("tab", { name: "All" }).click();
    await expect(rail.getByRole("button", { name: /^Billing question/ })).toBeVisible();
    await expect(rail.getByRole("button", { name: /^Export settings/ })).toBeVisible();

    await rail.getByRole("button", { name: "Delete: Billing question" }).click();
    await expect(rail.getByText("Delete this conversation?")).toBeVisible();
    await rail.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(rail.getByRole("button", { name: /^Billing question/ })).toHaveCount(0);

    await page.reload();
    const again = page.getByRole("complementary", { name: "Conversations" });
    await again.getByRole("tab", { name: "All" }).click();
    await expect(again.getByRole("button", { name: /^Export settings/ })).toBeVisible();
    await expect(again.getByRole("button", { name: /^Billing question/ })).toHaveCount(0);
  });

  test("is told to sign in when the token has expired", async ({ page }) => {
    const token = await signToken({ sub: WIDGET.visitors.one.subject }, { exp: "-1h" });
    await openHost(page, { attrs: { mode: "inline" }, token, style: "display:block;height:600px" });
    const dialog = page.getByRole("dialog", { name: "Help" });
    await dialog.getByRole("textbox", { name: "Ask a question…" }).fill("Hello?");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByText("Please sign in to continue.")).toBeVisible();
  });
});
