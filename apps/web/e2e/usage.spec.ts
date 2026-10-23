import { expect, type Page, test } from "@playwright/test";

import { USAGE, WIDGET } from "./seed";

/**
 * The Usage page (spec: usage-page) on the seeded usage threads. The seed
 * shares its database with gap rows and identity threads that also fall in
 * the last seven days, so the exact numbers are asserted behind the
 * `user_type=customer` filter, which only the usage threads carry.
 */
const CUSTOMER = "/usage?period=7d&ctx.user_type=customer";

/** A headline card by its label; the value is the next definition. */
function card(page: Page, label: string) {
  return page.locator("dl > *").filter({ has: page.getByText(label, { exact: true }) });
}

test.describe("Usage", () => {
  test("counts customers' questions, conversations, visitors and returns", async ({ page }) => {
    await page.goto(CUSTOMER);
    await expect(page.getByRole("heading", { name: "Usage", level: 1 }).last()).toBeVisible();
    await expect(card(page, "Questions").locator("dd")).toHaveText("5");
    await expect(card(page, "Conversations").locator("dd")).toHaveText("3");
    await expect(card(page, "Visitors").locator("dd")).toHaveText("2");
    await expect(card(page, "Returning visitors").locator("dd")).toHaveText("50%");
    // The filter is a chip whose × is a link to the view without it.
    const chip = page.getByRole("list", { name: "Filters" }).getByRole("listitem");
    await expect(chip).toContainText("user_type:");
    await expect(chip).toContainText("customer");
    await expect(chip.getByRole("link", { name: "Remove filter user_type" })).toHaveAttribute(
      "href",
      "/usage?period=7d",
    );
  });

  test("splits every number by a context key", async ({ page }) => {
    await page.goto("/usage?period=7d&split=user_type");
    const questions = card(page, "Questions");
    await expect(questions).toContainText("customer: 5");
    await expect(questions).toContainText("internal: 2");
    await expect(card(page, "Visitors")).toContainText("customer: 2");
    // The legend names the series; the series order is by size.
    await expect(page.getByText("customer", { exact: true }).first()).toBeVisible();
  });

  test("breaks customers down by account", async ({ page }) => {
    await page.goto(`${CUSTOMER}&by=account`);
    const table = page.getByRole("table").first();
    const acme = table.getByRole("row").filter({ hasText: USAGE.accounts.acme.name });
    const globex = table.getByRole("row").filter({ hasText: USAGE.accounts.globex.name });
    await expect(acme.getByRole("cell").nth(1)).toHaveText("1");
    await expect(acme.getByRole("cell").nth(2)).toHaveText("2");
    await expect(acme.getByRole("cell").nth(3)).toHaveText("3");
    await expect(globex.getByRole("cell").nth(3)).toHaveText("2");
    await expect(
      table.getByRole("row").filter({ hasText: USAGE.accounts.initech.name }),
    ).toHaveCount(0);
    // A row is a door: it adds the account as a filter.
    await acme.getByRole("link", { name: USAGE.accounts.acme.name }).click();
    await page.waitForURL(/ctx\.account=acc_acme/);
    await expect(card(page, "Questions").locator("dd")).toHaveText("3");
  });

  test("groups questions by topic and opens the conversations behind one", async ({ page }) => {
    await page.goto(CUSTOMER);
    const topics = page.getByRole("table").last();
    const billing = topics.getByRole("row").filter({ hasText: "Billing" });
    await expect(billing.getByRole("cell").nth(1)).toHaveText("3");
    await expect(
      topics.getByRole("row").filter({ hasText: "Exports" }).getByRole("cell").nth(1),
    ).toHaveText("2");
    await expect(topics.getByText("Not yet labelled")).toHaveCount(0);

    await page.goto("/usage?period=7d");
    await expect(page.getByRole("table").last().getByText("Not yet labelled")).toBeVisible();
    await expect(
      page.getByRole("table").last().getByRole("row").filter({ hasText: "Other" }),
    ).toHaveCount(1);

    await page.goto(CUSTOMER);
    await billing.getByRole("link", { name: "Billing" }).click();
    await page.waitForURL(/\/conversations\?period=7d&topic=billing&ctx\.user_type=customer/);
    const narrowed = page.getByRole("list", { name: "Narrowed to" });
    await expect(narrowed).toContainText("Topic:");
    await expect(narrowed).toContainText("Billing");
    await expect(narrowed).toContainText("user_type:");
    await expect(page.getByRole("link", { name: "How are invoices issued?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "How do I schedule an export?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Can I export to CSV?" })).toHaveCount(0);
  });

  test("names no visitor", async ({ page }) => {
    for (const url of [
      "/usage?period=all&split=user_type&by=account",
      "/usage?period=all&by=site",
    ]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "Usage", level: 1 }).last()).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const v of Object.values(WIDGET.visitors)) {
        expect(text).not.toContain(v.email);
        expect(text).not.toContain(v.name);
      }
    }
  });

  test("the navigation lists it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "sidebar is collapsed at phone width");
    await page.goto("/usage");
    await expect(page.getByRole("link", { name: "Usage", exact: true })).toHaveAttribute(
      "href",
      "/usage",
    );
  });
});

test("the Conversations page opens the newest thread of the narrowed view", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone", "the thread pane is hidden at phone width");
  await page.goto("/conversations?period=7d&topic=exports&ctx.user_type=customer");
  const transcript = page.locator("section").first();
  await expect(transcript.getByRole("heading", { level: 2 })).toHaveText(
    "How do I schedule an export?",
  );
});
