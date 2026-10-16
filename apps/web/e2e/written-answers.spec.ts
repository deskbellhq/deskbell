import { expect, test } from "@playwright/test";

import { SEED } from "./seed";

const { H } = SEED.clusters;

/**
 * The written answers page (spec: written-answers-naming, corrections-source):
 * the seeded answer with the gap it was written for, the way in from the
 * Sources card and the sidebar, and the add, edit and delete round trip. The
 * suite runs no worker, so a fresh answer stays at "Indexing…"; the state
 * itself is what is asserted.
 */
test.describe("Written answers", () => {
  test("the sources page counts the answers on a card that links to them", async ({ page }) => {
    await page.goto("/sources");
    const card = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Written answers" }),
    });
    await expect(card).toContainText("1 answer");
    await expect(card).toContainText("1 indexing");
    await card.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/\/sources\/answers$/);
    await expect(
      page.getByRole("heading", { name: "Written answers", level: 1 }).last(),
    ).toBeVisible();
  });

  test("the sidebar lists the page under Sources", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 768, "the sidebar is a sheet on a phone");
    await page.goto("/sources/answers");
    const entry = page.getByRole("link", { name: "Written answers", exact: true }).first();
    await expect(entry).toHaveAttribute("href", "/sources/answers");
    await expect(entry).toHaveAttribute("data-active", "true");
  });

  test("lists the seeded answer with its gap and indexing state", async ({ page }) => {
    await page.goto("/sources/answers");
    const pair = page.getByRole("row").filter({ hasText: H.label });
    await expect(pair).toContainText("Open Billing, choose Cancel plan, and confirm.");
    await expect(pair.getByRole("link", { name: H.label })).toHaveAttribute(
      "href",
      `/gaps?gap=${H.id}`,
    );
    await expect(pair).toContainText("Resolved");
    await expect(pair).toContainText("Indexing…");
  });

  test("adds an answer, edits it, and deletes it behind a confirmation", async ({ page }) => {
    const question = "Can I pay yearly?";
    await page.goto("/sources/answers");
    await page.getByRole("button", { name: "Write an answer" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Question", { exact: true }).fill(question);
    await drawer
      .getByLabel("Answer", { exact: true })
      .fill("Yes. Yearly billing costs ten months.");
    await drawer.getByRole("button", { name: "Save answer" }).click();
    await expect(drawer).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: question });
    await expect(row).toContainText("Yes. Yearly billing costs ten months.");
    await expect(row).toContainText("—");

    await row.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog");
    await expect(edit.getByLabel("Answer", { exact: true })).toHaveValue(
      "Yes. Yearly billing costs ten months.",
    );
    await edit.getByLabel("Answer", { exact: true }).fill("Yes. Yearly billing costs nine months.");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    await expect(row).toContainText("Yes. Yearly billing costs nine months.");

    await row.getByRole("button", { name: `Delete answer: ${question}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete answer" }).click();
    await expect(page.getByRole("row").filter({ hasText: question })).toHaveCount(0);
  });

  test("fits a phone: the body never scrolls sideways", async ({ page }) => {
    await page.goto("/sources/answers");
    await expect(page.getByRole("button", { name: "Write an answer" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
