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

/** The table under one of the labelled sections: Topics, Intent or Signals. */
function labelTable(page: Page, heading: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^${heading}`) }) })
    .getByRole("table");
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
    const topics = labelTable(page, "Topics");
    const billing = topics.getByRole("row").filter({ hasText: "Billing" });
    await expect(billing.getByRole("cell").nth(1)).toHaveText("3");
    await expect(
      topics.getByRole("row").filter({ hasText: "Exports" }).getByRole("cell").nth(1),
    ).toHaveText("2");
    await expect(topics.getByText("Not yet labelled")).toHaveCount(0);

    await page.goto("/usage?period=7d");
    await expect(labelTable(page, "Topics").getByText("Not yet labelled")).toBeVisible();
    await expect(
      labelTable(page, "Topics").getByRole("row").filter({ hasText: "Other" }),
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

  test("counts intents and signals and opens the conversations behind them", async ({ page }) => {
    await page.goto(CUSTOMER);
    const intents = labelTable(page, "Intent");
    const howTo = intents.getByRole("row").filter({ hasText: "How-to" });
    await expect(howTo.getByRole("cell").nth(1)).toHaveText("2");
    await expect(howTo.getByRole("cell").nth(2)).toHaveText("40%");
    await expect(
      intents.getByRole("row").filter({ hasText: "Request" }).getByRole("cell").nth(1),
    ).toHaveText("1");
    await expect(intents.getByText("Not yet labelled")).toHaveCount(0);
    // The reading names the leader and the share of requests.
    await expect(page.getByText("How-to leads with 40% of questions; 20% asked")).toBeVisible();

    const signals = labelTable(page, "Signals");
    const pushback = signals.getByRole("row").filter({ hasText: "Pushback" });
    await expect(pushback.getByRole("cell").nth(1)).toHaveText("1");
    await expect(pushback.getByRole("cell").nth(2)).toHaveText("20%");
    await expect(
      signals.getByRole("row").filter({ hasText: "Wants a human" }).getByRole("cell").nth(1),
    ).toHaveText("1");
    // The not-yet-labelled question has no row here: a signal is a fact, not a gap.
    await expect(signals.getByText("Not yet labelled")).toHaveCount(0);

    // Whole project: the unlabelled question shows under Intent, and the rule is one hover away.
    await page.goto("/usage?period=7d");
    await expect(labelTable(page, "Intent").getByText("Not yet labelled")).toBeVisible();
    await labelTable(page, "Intent").getByRole("button", { name: "Intent", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toContainText("one of six fixed intents");

    // A row is a door into the inbox, narrowed with a chip.
    await page.goto(CUSTOMER);
    await signals.getByRole("link", { name: "Wants a human" }).click();
    await page.waitForURL(/\/conversations\?period=7d&signal=wants_human&ctx\.user_type=customer/);
    const narrowed = page.getByRole("list", { name: "Narrowed to" });
    await expect(narrowed).toContainText("Signal:");
    await expect(narrowed).toContainText("Wants a human");
    await expect(page.getByRole("link", { name: "Can I export to CSV?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "How are invoices issued?" })).toHaveCount(0);
    await expect(narrowed.getByRole("link", { name: "Remove Signal filter" })).toHaveAttribute(
      "href",
      "/conversations?period=7d&ctx.user_type=customer",
    );

    await page.goto("/conversations?period=7d&intent=troubleshooting");
    await expect(page.getByRole("list", { name: "Narrowed to" })).toContainText("Troubleshooting");
    await expect(page.getByRole("link", { name: "How do I schedule an export?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Can I export to CSV?" })).toHaveCount(0);

    // Only a thread that pushed back or asked for a person wears the inbox glyph.
    await page.goto("/conversations?period=7d&intent=how_to&ctx.user_type=customer");
    await expect(
      page.getByRole("link", { name: "How are invoices issued?" }).getByLabel(/asked for a person/),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("link", { name: "How do I schedule an export?" })
        .getByLabel(/asked for a person/),
    ).toBeVisible();
  });

  test("lists signed-in visitors by name and no one else", async ({ page }) => {
    // The identity seed's two visitors asked within the week; the usage threads are anonymous.
    await page.goto("/usage?period=7d");
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { level: 2, name: /^Visitors/ }) });
    await expect(section.getByRole("heading", { level: 2 })).toContainText("2 signed in");
    await expect(section).toContainText("anonymous sessions counted, not listed");
    // Two days each: nobody in the seed wears the badge yet.
    await expect(section.getByRole("button", { name: "Power user" })).toHaveCount(0);
    // A column head explains itself on focus.
    await section.getByRole("button", { name: "Questions", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toContainText(
      "Messages this visitor sent in the period",
    );
    // The reading line states the rule in words.
    await expect(section).toContainText(`${WIDGET.visitors.one.name} asks most`);
    await expect(section).toContainText("0 of 2 signed-in visitors are power users");
    const one = section.getByRole("row").filter({ hasText: WIDGET.visitors.one.name });
    await expect(one.getByRole("cell").nth(1)).toHaveText("2");
    await expect(one.getByRole("cell").nth(2)).toHaveText("2");
    await expect(one).toContainText(WIDGET.visitors.one.email);
    await expect(
      section
        .getByRole("row")
        .filter({ hasText: WIDGET.visitors.two.name })
        .getByRole("cell")
        .nth(1),
    ).toHaveText("1");
    // No anonymous session id reaches the page.
    const text = await page.locator("body").innerText();
    for (const t of USAGE.threads) expect(text).not.toContain(t.session);

    // Behind a filter no signed-in visitor matches, nobody is named.
    await page.goto(CUSTOMER);
    await expect(page.getByRole("heading", { level: 2, name: /^Visitors/ })).toHaveCount(0);
    const customers = await page.locator("body").innerText();
    for (const v of Object.values(WIDGET.visitors)) {
      expect(customers).not.toContain(v.email);
      expect(customers).not.toContain(v.name);
    }

    // A visitor is a door to their threads, shown as a chip with a way back.
    await page.goto("/usage?period=7d");
    await one.getByRole("link", { name: WIDGET.visitors.one.name }).click();
    await page.waitForURL(/\/conversations\?period=7d&user=eu_e2e_v1/);
    const narrowed = page.getByRole("list", { name: "Narrowed to" });
    await expect(narrowed).toContainText("Visitor:");
    await expect(narrowed).toContainText(WIDGET.visitors.one.name);
    await expect(page.getByRole("link", { name: WIDGET.threads.v1Site.title })).toBeVisible();
    await expect(page.getByRole("link", { name: WIDGET.threads.v1Free.title })).toBeVisible();
    await expect(page.getByRole("link", { name: WIDGET.threads.v2.title })).toHaveCount(0);
    await expect(narrowed.getByRole("link", { name: "Remove Visitor filter" })).toHaveAttribute(
      "href",
      "/conversations?period=7d",
    );
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
  // Each question wears its intent and signals (spec: intent-and-signals).
  await expect(transcript.getByText("How-to", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Troubleshooting", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Pushback", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Frustration", { exact: true })).toBeVisible();
  // The inbox marks the thread that pushed back and the one that wants a person.
  await expect(
    page
      .getByRole("link", { name: "How do I schedule an export?" })
      .getByLabel(/asked for a person/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Can I export to CSV?" }).getByLabel(/asked for a person/),
  ).toBeVisible();
});
