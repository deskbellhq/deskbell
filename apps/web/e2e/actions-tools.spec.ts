import { expect, test } from "@playwright/test";

import { SEED } from "./seed";

const { server } = SEED.actions;

/**
 * The tools view of Actions (spec: actions-ia): one row per tool with its
 * usage, a policy that saves from the row, and a page per tool with its
 * recent calls. Rows come from the seeded server and its four calls.
 */
test.describe("Actions › Tools", () => {
  test("lists every tool with its policy and usage", async ({ page }) => {
    await page.goto("/actions");
    await expect(page.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const lookup = page.getByTestId("tool-seeded-shop-order_status");
    await expect(lookup).toContainText("Look up your order");
    await expect(lookup).toContainText(server.name);
    // Two calls in the seed: one done at 1.2 s, one failed.
    await expect(lookup).toContainText("2");
    await expect(lookup).toContainText("1.2 s");
    await expect(
      lookup.getByRole("radiogroup", { name: "Policy for order_status" }).getByRole("radio", {
        name: "Allowed",
      }),
    ).toHaveAttribute("aria-checked", "true");
    const cancel = page.getByTestId("tool-seeded-shop-cancel_order");
    await expect(cancel).toContainText("Cancel your order");
    await expect(page.getByText("2 of 2 tools on")).toBeVisible();
  });

  test("saves a policy from the row and shows it on the tool page", async ({ page }) => {
    await page.goto("/actions");
    const cancel = page.getByTestId("tool-seeded-shop-cancel_order");
    await cancel
      .getByRole("radiogroup", { name: "Policy for cancel_order" })
      .getByRole("radio", { name: "Off" })
      .click();
    await expect(page.getByText("cancel_order: Off")).toBeVisible();

    await cancel.getByRole("link", { name: "Cancel your order" }).click();
    await expect(page).toHaveURL(new RegExp(`/actions/${server.id}/cancel_order$`));
    await expect(page.getByRole("heading", { name: "Cancel your order", level: 1 })).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Policy for cancel_order" }).getByRole("radio", {
        name: "Off",
      }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Cancels an order.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent calls" })).toBeVisible();
    // The two confirmation calls, without a Tool column that would repeat the title.
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("columnheader", { name: "Tool" })).toHaveCount(0);

    // Put it back for the suites that run after this one.
    await page
      .getByRole("radiogroup", { name: "Policy for cancel_order" })
      .getByRole("radio", { name: "Needs confirmation" })
      .click();
    await expect(page.getByText("cancel_order: Needs confirmation")).toBeVisible();
  });

  test("the sidebar groups the agent's pages apart from activity", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/actions");
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByText("Agent", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Activity", { exact: true })).toBeVisible();
  });
});
