import { createDb, documents, projects, sources } from "@deskbell/db";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { e2eDatabaseUrl } from "./database";

/**
 * The getting-started page (spec: overview-getting-started), walked in the
 * seeded state: answers exist (the gap rows), no source does, and the
 * allowlist is empty. That is a legitimate mid-way state — the pill still
 * says to add docs, because that is the first undone step — and it touches
 * none of the rows the gaps suite depends on.
 */

const PROJECT = "proj_dev";
const SOURCE = "src_e2e_overview";

const statCard = (page: Page) => page.getByText("Threads started by visitors");
const guideHeading = (page: Page) =>
  page.getByRole("heading", { name: "Get your first answer in about a minute", level: 1 });
const pill = (page: Page, text: string) => page.locator('[role="status"]', { hasText: text });

test.describe("Overview before the widget is live", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(guideHeading(page)).toBeVisible();
  });

  test("is the guide, not the analytics", async ({ page }) => {
    await expect(statCard(page)).toHaveCount(0);
    await expect(pill(page, "Waiting for your docs")).toBeVisible();

    // Step two already happened in the seed: the earliest answer was a
    // refusal, so the step shows the proof rather than the ask button.
    await expect(page.getByText("How do I rotate a key?")).toBeVisible();
    await expect(page.getByText("declined rather than guessing")).toBeVisible();

    // Step three carries the real tag and the production wording.
    const snippet = page.locator("pre");
    await expect(snippet).toContainText("pk_dev_default");
    await expect(snippet).toContainText("/deskbell.js");
    await expect(page.getByRole("button", { name: "Copy snippet" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy prompt for your coding agent" }),
    ).toBeVisible();
    await expect(page.getByText("Your site's origin is required")).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow origin" })).toBeVisible();
  });

  test("names the model key the server is missing", async ({ page }) => {
    // The test server pins OPENAI_API_KEY to empty (playwright.config.ts), so
    // a developer's real key cannot hide this locally.
    // Filtered: the router's route announcer is an alert as well.
    const alert = page.getByRole("alert").filter({ hasText: "Model key missing" });
    await expect(alert).toContainText("Model key missing");
    await expect(alert).toContainText("OPENAI_API_KEY");
  });

  test("a ready source shows its pages and moves the pill on", async ({ page }) => {
    const db = createDb(e2eDatabaseUrl());
    try {
      await db.insert(sources).values({
        id: SOURCE,
        orgId: "org_dev",
        projectId: PROJECT,
        type: "docs-crawler",
        config: { url: "https://docs.example.test", maxPages: 50 },
        status: "ready",
      });
      await db.insert(documents).values(
        ["intro", "keys"].map((slug) => ({
          id: `doc_e2e_overview_${slug}`,
          orgId: "org_dev",
          sourceId: SOURCE,
          url: `https://docs.example.test/${slug}`,
          title: slug,
          contentHash: `e2e-${slug}`,
        })),
      );
      await page.reload();
      await expect(page.getByText("Ready · 2 pages")).toBeVisible();
      await expect(page.getByText("https://docs.example.test", { exact: true })).toBeVisible();
      // Answers already exist, so the next thing to do is install — and the
      // source form has nothing left to add.
      await expect(pill(page, "Ready to install")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add source" })).toHaveCount(0);
    } finally {
      await db.delete(documents).where(eq(documents.sourceId, SOURCE));
      await db.delete(sources).where(eq(sources.id, SOURCE));
      await db.$client.end();
    }
  });

  test("fits a phone: the body never scrolls sideways", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Copy snippet" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // Last: skipping stores the one onboarding bit, and the phone project
  // reruns this file against the same seed, so it is cleared before the end.
  test("skip shows the analytics view", async ({ page }, testInfo) => {
    const db = createDb(e2eDatabaseUrl());
    try {
      await page.getByRole("button", { name: "Skip to overview" }).click();
      await expect(statCard(page)).toBeVisible();
      await expect(guideHeading(page)).toHaveCount(0);
      // The table says how sure the agent was, never "Answered": the seed has
      // a grounded answer (B), a weak one (C) and refusals.
      const table = page.getByRole("table");
      await expect(table.getByText("Certain", { exact: true }).first()).toBeVisible();
      await expect(table.getByText("Uncertain", { exact: true }).first()).toBeVisible();
      await expect(table.getByText("weak grounding").first()).toBeVisible();
      await expect(table.getByText("Answered", { exact: true })).toHaveCount(0);
      // The chart and the rate card speak the same words as the badge
      // (spec: overview-live-metrics, addendum): certain against uncertain,
      // never answered against unanswered.
      // The card's description is the short form under 540px.
      await expect(page.getByText(/^Certain vs uncertain/).filter({ visible: true })).toBeVisible();
      await expect(page.getByText("Share of answers that were certain")).toBeVisible();
      await expect(page.getByText(/Answered vs unanswered/)).toHaveCount(0);
      await expect(page.getByText("Unanswered", { exact: true })).toHaveCount(0);
      // A column is a door (spec: chart-day-drilldown): today's column opens
      // the conversations with a message today.
      const today = new Date().toISOString().slice(0, 10);
      // A phone opens on the last 7 days already, and hides the toggle.
      if (testInfo.project.name !== "phone")
        await page.getByRole("radio", { name: "Last 7 days" }).click();
      const columns = page.locator(".recharts-bar-rectangle path");
      await expect(columns.last()).toBeVisible();
      await columns.last().click();
      await expect(page).toHaveURL(`/conversations?from=${today}&to=${today}`);
      await expect(page.getByRole("combobox", { name: "Period" })).toBeVisible();
    } finally {
      await db
        .update(projects)
        .set({ onboardingDismissedAt: null })
        .where(eq(projects.id, PROJECT));
      await db.$client.end();
    }
  });
});
