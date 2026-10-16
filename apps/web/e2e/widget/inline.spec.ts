import { expect, test } from "@playwright/test";
import { allowHostOrigin, openHost, resetHostState } from "./host";

test.describe("inline mode", () => {
  test.beforeAll(allowHostOrigin);
  test.afterAll(resetHostState);

  test("fills its element, has no launcher, and shows a header only when slotted", async ({
    page,
  }) => {
    await openHost(page, { attrs: { mode: "inline" }, style: "display:block;height:600px" });
    await expect(page.getByRole("button", { name: "Open help" })).toHaveCount(0);
    const dialog = page.getByRole("dialog", { name: "Help" });
    await expect(dialog).toBeVisible();
    await expect(page.locator('deskbell-widget [part="header"]')).toHaveCount(0);
    const box = await dialog.boundingBox();
    expect(box?.height).toBeGreaterThan(560);
    await expect(dialog.getByRole("textbox", { name: "Ask a question…" })).toBeVisible();

    await openHost(page, {
      attrs: { mode: "inline" },
      style: "display:block;height:600px",
      children: '<div slot="header">Help centre</div>',
    });
    await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
    await expect(page.locator('deskbell-widget [part="header"]')).toHaveCount(1);
    await expect(page.getByText("Help centre")).toBeVisible();
  });
});
