import { expect, test } from "@playwright/test";

import { SEED } from "./seed";

const { B, H } = SEED.clusters;

/**
 * The inbox and the thread page (spec: conversations-inbox-polish,
 * answer-citation-labels). The seed's newest thread is B's: asked now,
 * answered with Markdown, marked down with a reason, cited a page and a
 * written answer. Only the transcript is asserted; the details aside is
 * hidden at phone width.
 */
test.describe("Conversations", () => {
  test("opens the newest thread on arrival, or the list on a phone", async ({
    page,
    isMobile,
  }, testInfo) => {
    await page.goto("/conversations");
    const phone = isMobile || testInfo.project.name === "phone";
    const transcript = page.locator("section").first();
    const rows = page.getByRole("link", { name: B.label });
    if (phone) {
      // The list is the index view; no thread is rendered until a row is tapped.
      await expect(rows.first()).toBeVisible();
      await expect(transcript).toBeHidden();
      return;
    }
    await expect(transcript.getByRole("heading", { level: 2 })).toHaveText(B.label);
    await expect(rows.first()).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/\/conversations$/);
  });

  test("renders the answer's Markdown, the vote's reason, and a way into Gaps", async ({
    page,
  }) => {
    await page.goto(`/conversations/conv_e2e_b1`);
    const transcript = page.locator("section").first();
    await expect(transcript.locator("ul > li").first()).toHaveText("Copy the project key");
    await expect(transcript.locator("strong")).toHaveText("Settings › Install");
    await expect(transcript.getByText("Marked inaccurate")).toBeVisible();
    await expect(transcript.getByRole("link", { name: "Open in Gaps" })).toHaveAttribute(
      "href",
      `/gaps?gap=${B.id}`,
    );
    // The footer line carries the model that wrote the answer.
    await expect(transcript.getByText("test/model")).toBeVisible();
  });

  test("names a refusal by its reason", async ({ page }) => {
    await page.goto("/conversations/conv_e2e_a1");
    const transcript = page.locator("section").first();
    await expect(transcript.getByText("Nothing retrieved")).toBeVisible();
    await page.goto("/conversations/conv_e2e_a2");
    await expect(page.locator("section").first().getByText("No grounded answer")).toBeVisible();
  });

  test("a day from the chart narrows the list, and the period control widens it", async ({
    page,
  }) => {
    // The seed asks B today and H eight days ago; the chart writes UTC days.
    const today = new Date().toISOString().slice(0, 10);
    const dayLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    await page.goto(`/conversations?from=${today}&to=${today}`);
    const list = page.getByRole("complementary");
    await expect(list.getByRole("link", { name: B.label })).toBeVisible();
    await expect(list.getByRole("link", { name: H.label })).toHaveCount(0);
    // The period control names the day, and the quick views carry it along.
    const period = list.getByRole("combobox", { name: "Period" });
    await expect(period).toHaveText(dayLabel);
    await expect(list.getByRole("link", { name: /^Needs attention/ })).toHaveAttribute(
      "href",
      `/conversations?view=attention&from=${today}&to=${today}`,
    );
    // Custom shows its two days; a preset navigates and hides them.
    await expect(list.getByLabel("From")).toHaveValue(today);
    await period.click();
    await page.getByRole("option", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/\/conversations\?period=7d$/);
    await expect(list.getByLabel("From")).toHaveCount(0);
    await expect(list.getByRole("link", { name: H.label })).toHaveCount(0);
    await period.click();
    await page.getByRole("option", { name: "All time" }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    await expect(list.getByRole("link", { name: H.label })).toBeVisible();
  });

  test("a feedback filter lists only marked-down threads and opens the newest", async ({
    page,
  }, testInfo) => {
    // The old address still works, and is rewritten to the chip it means.
    await page.goto("/conversations?filter=down");
    const narrowed = page.getByRole("list", { name: "Narrowed to" });
    await expect(narrowed).toContainText("Feedback:");
    await expect(narrowed).toContainText("Marked down");
    await expect(page.getByRole("link", { name: B.label })).toBeVisible();
    await expect(page.getByRole("link", { name: H.label })).toHaveCount(0);
    if (testInfo.project.name === "phone") return;
    await expect(page.locator("section").first().getByRole("heading", { level: 2 })).toHaveText(
      B.label,
    );
    // A row keeps the view while moving between threads.
    await page.getByRole("link", { name: B.label }).first().click();
    await expect(page).toHaveURL(/\/conversations\/conv_e2e_b1\?feedback=down$/);
    // Removing a narrowing opens the newest thread of the wider view, like a quick view does.
    await expect(narrowed.getByRole("link", { name: "Remove Feedback filter" })).toHaveAttribute(
      "href",
      "/conversations",
    );
  });

  test("the row marks the outcome and what needs reading, and the views count them", async ({
    page,
  }) => {
    await page.goto("/conversations");
    const list = page.getByRole("complementary");
    // B: answered from grounding, marked down. A1: refused. Both need attention; only A1 is uncertain.
    const b = list.getByRole("link", { name: B.label }).first();
    await expect(b.getByRole("img", { name: "Certain" })).toBeVisible();
    await expect(b.getByLabel("Marked an answer down")).toBeVisible();
    const a = list.getByRole("link", { name: "How do I export a feed?" }).first();
    await expect(a.getByRole("img", { name: "Uncertain" })).toBeVisible();
    await expect(a.getByLabel("Marked an answer down")).toHaveCount(0);

    const views = list.getByRole("navigation", { name: "View" });
    const all = await views.getByRole("link", { name: /^All/ }).innerText();
    const attention = await views.getByRole("link", { name: /^Needs attention/ }).innerText();
    const n = (t: string) => Number(t.replace(/\D/g, ""));
    expect(n(attention)).toBeGreaterThan(0);
    expect(n(attention)).toBeLessThan(n(all));
    await views.getByRole("link", { name: /^Needs attention/ }).click();
    await expect(page).toHaveURL(/\/conversations\?view=attention$/);
    await expect(list.getByRole("link", { name: B.label })).toBeVisible();
    await expect(list.getByRole("link", { name: "How do I export a feed?" }).first()).toBeVisible();
    // A thread with a certain answer and nothing marked is not listed here.
    await expect(list.getByRole("link", { name: "How are invoices issued?" })).toHaveCount(0);
    await expect(list.getByRole("link", { name: /^Needs attention/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the filter menu adds a chip and narrows the list", async ({ page }) => {
    await page.goto("/conversations");
    const list = page.getByRole("complementary");
    await list.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("menuitem", { name: "Outcome" }).hover();
    await page.getByRole("menuitem", { name: "Unanswered" }).click();
    await expect(page).toHaveURL(/\/conversations\?outcome=unanswered$/);
    const narrowed = page.getByRole("list", { name: "Narrowed to" });
    await expect(narrowed).toContainText("Outcome:");
    await expect(narrowed).toContainText("Unanswered");
    await expect(list.getByRole("link", { name: B.label })).toHaveCount(0);
    // A context key the host sent is offered with the names it sent.
    await list.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("menuitem", { name: "account" }).hover();
    await page.getByRole("menuitem", { name: "Acme" }).click();
    await expect(page).toHaveURL(/outcome=unanswered&ctx\.account=acc_acme$/);
    await expect(narrowed).toContainText("account:");
    await expect(narrowed).toContainText("Acme");
    await narrowed.getByRole("link", { name: "Remove Outcome filter" }).click();
    await expect(page).toHaveURL(/\/conversations\?ctx\.account=acc_acme$/);
    await expect(list.getByRole("link", { name: "How are invoices issued?" })).toBeVisible();
  });

  test("labels a cited written answer on the message, and a page by its title alone", async ({
    page,
  }) => {
    await page.goto("/conversations/conv_e2e_b1");
    // The transcript is the first section; the aside with "Sources cited" is
    // a sibling and hidden on a phone.
    const transcript = page.locator("section").first();
    const written = transcript.locator('[data-slot="badge"]', { hasText: H.label });
    await expect(written).toContainText("Written answer");
    const cited = transcript.locator("a[href='https://docs.example.test/keys']");
    await expect(cited).toHaveText("Project keys");
  });
});
