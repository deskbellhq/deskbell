import { createDb, documents, gapClusters } from "@deskbell/db";
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { e2eDatabaseUrl } from "./database";
import { SEED } from "./seed";

const { A, B, C, D, E, F, G, H } = SEED.clusters;

/** The table rows, by the question link inside each. */
function rowOf(page: Page, question: string) {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: question, exact: true }) });
}

/** Questions in table order, for order assertions. */
async function questionsInOrder(page: Page): Promise<string[]> {
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).not.toHaveCount(0);
  const links = table.getByRole("row").locator("td:first-child a[href^='/conversations/']");
  return links.allTextContents();
}

/** The status control: a link per view, named by the view with its count after it. */
function statusLink(page: Page, label: "Open" | "Resolved" | "All") {
  return page.getByRole("navigation", { name: "Status" }).getByRole("link", { name: label });
}

/** Radix select: open it, choose the option, and wait for the URL it navigates to. */
async function chooseOrder(page: Page, label: string, param: string) {
  await page.getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: label }).click();
  await page.waitForURL((url) => url.searchParams.get("sort") === param);
}

test.describe("Gaps", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/gaps");
    await expect(page.getByRole("heading", { name: "Gaps", level: 1 }).last()).toBeVisible();
  });

  test("lists the last 30 days with badges, totals and the newest gap first", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: "Last 30 days" }).or(page.getByRole("link", { name: "30d" })),
    ).toHaveAttribute("aria-current", "page");
    expect(await questionsInOrder(page)).toEqual([B.label, C.label, A.label, E.label]);

    await expect(rowOf(page, A.label)).toContainText("Refused");
    await expect(rowOf(page, A.label)).toContainText("2 phrasings");
    await expect(rowOf(page, A.label)).toContainText(SEED.analysis.title);
    await expect(rowOf(page, B.label)).toContainText("Marked down");
    await expect(rowOf(page, B.label)).toContainText("inaccurate");
    await expect(rowOf(page, C.label)).toContainText("Weak");
    await expect(rowOf(page, C.label)).toContainText("cited everything");
    await expect(page.getByRole("link", { name: D.label, exact: true })).toHaveCount(0);

    const totals = page.getByRole("definition");
    await expect(totals.nth(0)).toHaveText("4");
    await expect(totals.nth(1)).toHaveText("3");
    await expect(totals.nth(2)).toHaveText("1");
    await expect(totals.nth(3)).toHaveText("1");
  });

  test("the period narrows the rows and the order switch reorders them", async ({ page }) => {
    await page
      .getByRole("link", { name: "Last 7 days" })
      .or(page.getByRole("link", { name: "7d" }))
      .first()
      .click();
    await page.waitForURL(/period=7d/);
    expect(await questionsInOrder(page)).toEqual([B.label, C.label]);

    await page
      .getByRole("link", { name: "All time" })
      .or(page.getByRole("link", { name: "All" }))
      .first()
      .click();
    await page.waitForURL(/period=all/);
    expect(await questionsInOrder(page)).toEqual([
      B.label,
      C.label,
      A.label,
      E.label,
      G.label,
      F.label,
    ]);
    await expect(page.getByRole("link", { name: D.label, exact: true })).toHaveCount(0);

    // Every status: the resolved clusters join at the bottom, newest first.
    await statusLink(page, "All").click();
    await page.waitForURL(/status=all/);
    await expect(rowOf(page, D.label)).toContainText("Resolved");
    await expect(rowOf(page, H.label)).toContainText("Answered");
    expect(await questionsInOrder(page)).toEqual([
      B.label,
      C.label,
      A.label,
      E.label,
      G.label,
      F.label,
      H.label,
      D.label,
    ]);

    await chooseOrder(page, "Most asked", "frequent");
    expect(await questionsInOrder(page)).toEqual([
      A.label,
      B.label,
      C.label,
      E.label,
      G.label,
      F.label,
      H.label,
      D.label,
    ]);
  });

  test("the status control counts each view and says when only resolved gaps remain", async ({
    page,
  }) => {
    await expect(statusLink(page, "Open")).toHaveText("Open4");
    await expect(statusLink(page, "Resolved")).toHaveText("Resolved1");
    await expect(statusLink(page, "All")).toHaveText("All5");
    await expect(statusLink(page, "Open")).toHaveAttribute("aria-current", "page");

    await page.goto("/gaps?period=7d&status=resolved");
    await expect(page.getByRole("table")).toContainText("No resolved gaps in the last 7 days");
  });

  test("the analysis bar offers the open clusters in view", async ({ page }) => {
    const bar = page.getByRole("status");
    await expect(bar).toContainText("3 open clusters have no analysis yet");
    await expect(bar).toContainText("daily token budget");
    await expect(page.getByRole("button", { name: "Analyze 3 open" })).toBeEnabled();
  });

  test("a request in flight shows on the row, in the bar and in the panel", async ({ page }) => {
    await page.goto("/gaps?period=all");
    await expect(rowOf(page, F.label)).toContainText("Analyzing…");
    const bar = page.getByRole("status");
    await expect(bar).toContainText("Analyzing 1 cluster…");
    await expect(bar.getByRole("button")).toHaveCount(0);

    await rowOf(page, F.label).getByRole("link", { name: "Details" }).click();
    const panel = page.getByRole("dialog");
    const button = panel.getByRole("button", { name: "Analyzing…" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(panel).toContainText("The model is reading this cluster");
  });

  test("a refused analysis says why and offers a retry", async ({ page }) => {
    await page.goto("/gaps?period=90d");
    await expect(rowOf(page, G.label)).toContainText("Daily token budget reached");
    const bar = page.getByRole("status");
    await expect(bar).toContainText("1 analysis failed — daily token budget reached");
    await expect(bar).toContainText("midnight UTC");
    await expect(page.getByRole("button", { name: "Analyze 4 open" })).toBeEnabled();

    await rowOf(page, G.label).getByRole("link", { name: "Details" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("alert")).toContainText("Daily token budget reached");
    await expect(panel.getByRole("alert")).toContainText("midnight UTC");
    await expect(panel.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  });

  test("the detail drawer is URL state: it shows the cluster, and closing is a navigation", async ({
    page,
  }) => {
    await rowOf(page, A.label).getByRole("link", { name: "Details" }).click();
    await page.waitForURL(/gap=gap_e2e_a/);
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: A.label })).toBeVisible();
    await expect(panel).toContainText("Open");
    await expect(panel).toContainText("Asked 2 times");
    await expect(panel).toContainText("Exporting feeds — how?");
    await expect(panel).toContainText("Importing a feed");
    await expect(panel).toContainText(SEED.analysis.finding);
    await expect(panel).toContainText(SEED.analysis.recommendation);
    await expect(panel).toContainText(SEED.analysis.suggestedFacts[0]);
    await expect(panel.getByRole("button", { name: "Re-analyze" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mark resolved" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Write an answer" })).toBeVisible();
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toBeHidden();
    await page.waitForURL((url) => !url.searchParams.has("gap"));

    // Browser back closes it too, since opening it was a navigation.
    await rowOf(page, B.label).getByRole("link", { name: "Details" }).click();
    await page.waitForURL(/gap=gap_e2e_b/);
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Analyze", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await page.waitForURL((url) => !url.searchParams.has("gap"));
    await expect(page.getByRole("dialog")).toBeHidden();

    // And a link to the view opens it directly.
    await page.goto("/gaps?gap=gap_e2e_b");
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Analyze", exact: true }),
    ).toBeVisible();
  });

  test("fits a phone: the drawer's primary action is in view without scrolling", async ({
    page,
  }) => {
    await page.goto("/gaps?gap=gap_e2e_b");
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: B.label })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Write an answer" })).toBeInViewport();
  });

  test("marking a cluster resolved moves it to the resolved view, and reopen brings it back", async ({
    page,
  }) => {
    await rowOf(page, B.label)
      .getByRole("button", { name: /More actions/ })
      .click();
    await expect(page.getByRole("menuitem", { name: "Copy as eval case" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Mark resolved" }).click();
    // Feedback is the row leaving and the counts moving, not a toast.
    await expect(rowOf(page, B.label)).toHaveCount(0);
    await expect(statusLink(page, "Open")).toHaveText("Open3");
    await expect(statusLink(page, "Resolved")).toHaveText("Resolved2");
    expect(await questionsInOrder(page)).toEqual([C.label, A.label, E.label]);

    await statusLink(page, "Resolved").click();
    await page.waitForURL(/status=resolved/);
    await expect(rowOf(page, B.label)).toContainText("Resolved");
    expect(await questionsInOrder(page)).toEqual([B.label, H.label]);

    await rowOf(page, B.label)
      .getByRole("button", { name: /More actions/ })
      .click();
    await page.getByRole("menuitem", { name: "Reopen" }).click();
    await expect(rowOf(page, B.label)).toHaveCount(0);
    await statusLink(page, "Open").click();
    await page.waitForURL((url) => !url.searchParams.has("status"));
    expect(await questionsInOrder(page)).toEqual([B.label, C.label, A.label, E.label]);
  });

  test("the copy button puts the cluster on the clipboard as a prompt", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/gaps?gap=gap_e2e_a");
    const panel = page.getByRole("dialog");
    const copy = panel.getByRole("button", { name: "Copy prompt for your coding agent" });
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect(copy).toHaveText(/Copy prompt for your coding agent/);

    const brief = await page.evaluate(() => navigator.clipboard.readText());
    expect(brief.startsWith(`# Docs gap: ${A.label}\n`)).toBe(true);
    expect(brief).toContain("> Exporting feeds — how?");
    expect(brief).toContain("Importing a feed — https://docs.example.test/");
    expect(brief).toContain(SEED.analysis.recommendation);
    expect(brief).toContain(`- [ ] ${SEED.analysis.suggestedFacts[0]}`);
    expect(brief).toContain("## Eval case");
    expect(brief).toMatch(/4\. Mark the gap resolved: http:\/\/localhost:\d+\/gaps\?gap=gap_e2e_a/);

    // The row offers the same brief, above the eval case.
    await panel.getByRole("button", { name: "Close" }).click();
    await rowOf(page, A.label)
      .getByRole("button", { name: /More actions/ })
      .click();
    const items = page.getByRole("menuitem");
    await expect(items.nth(0)).toHaveText("Copy prompt for your coding agent");
    await expect(items.nth(1)).toHaveText("Copy as eval case");
  });

  test("downloads the view as one prompt per visible cluster", async ({ page }) => {
    await page.getByRole("button", { name: "Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Prompts for your coding agent" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^deskbell-gaps-.*-30d-\d{4}-\d{2}-\d{2}\.md$/);
    const md = await new Response(
      (await file.createReadStream()) as unknown as ReadableStream,
    ).text();
    expect(md.startsWith("# Docs gaps: ")).toBe(true);
    expect(md.match(/^# Docs gap: /gm)).toHaveLength(4);
    expect(md).toContain(`# Docs gap: ${A.label}`);
    expect(md).toContain(SEED.analysis.finding);
  });

  test("the answer form offers a draft, and says why when the model cannot", async ({ page }) => {
    await page.goto("/gaps?gap=gap_e2e_a&write=1");
    const panel = page.getByRole("dialog");
    const answer = panel.getByRole("textbox", { name: "Answer" });
    await expect(answer).toBeVisible();
    const draft = panel.getByRole("button", { name: "Draft with AI" });
    await expect(draft).toBeVisible();

    // No model key is configured for this suite, so the call fails. What is
    // under test is that the form says so and keeps what was typed.
    await answer.fill("half-written answer");
    await draft.click();
    await expect(panel.getByRole("alert")).toContainText("could not draft", { timeout: 20_000 });
    await expect(answer).toHaveValue("half-written answer");
    await expect(draft).toBeEnabled();
  });

  test("exports the view as CSV and as a dataset the harness can load", async ({ page }) => {
    await page.getByRole("button", { name: "Export" }).click();
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "CSV for a spreadsheet" }).click();
    const csv = await (await csvDownload).createReadStream();
    const csvText = await new Response(csv as unknown as ReadableStream).text();
    const [header, ...lines] = csvText.trim().split("\r\n");
    expect(header?.startsWith("cluster_id,question,status,times")).toBe(true);
    expect(lines).toHaveLength(4);
    expect(csvText).toContain(`${A.id},${A.label},open,2,2,0,0`);
    expect(csvText).toContain(SEED.analysis.recommendation);

    await page.getByRole("button", { name: "Export" }).click();
    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Eval dataset (JSON)" }).click();
    const json = await new Response(
      (await (await jsonDownload).createReadStream()) as unknown as ReadableStream,
    ).text();
    const dataset = JSON.parse(json) as { name: string; cases: Array<Record<string, unknown>> };
    expect(dataset.name).toBe("real-traffic-default-project-30d");
    expect(dataset.cases).toHaveLength(4);
    const a = dataset.cases.find((c) => c.question === A.label);
    expect(a).toMatchObject({
      kind: "answerable",
      expectedFacts: [...SEED.analysis.suggestedFacts],
      tags: ["real-traffic", "refused"],
      source: { kind: "real", messageId: "msg_e2e_a2_a" },
    });
  });

  test("fits a phone: the toolbar works and the body never scrolls sideways", async ({ page }) => {
    await expect(page.getByRole("combobox", { name: "Order" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze 3 open" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  // Writes a correction and resolves A; both are undone before it ends, so
  // the phone project's rerun of this file sees the seed it expects.
  test("writing an answer from the drawer resolves the cluster and lists the pair", async ({
    page,
  }) => {
    const db = createDb(e2eDatabaseUrl());
    const answer = "Open the feed, press Export, and pick CSV.";
    try {
      // The row menu links straight into the form; so does this URL.
      await page.goto("/gaps?gap=gap_e2e_a&write=1");
      const panel = page.getByRole("dialog");
      await expect(panel.getByLabel("Answer", { exact: true })).toBeFocused();
      await expect(panel.getByLabel("Question", { exact: true })).toHaveValue(A.label);
      await panel.getByLabel("Answer", { exact: true }).fill(answer);
      await panel.getByRole("button", { name: "Save answer" }).click();
      await expect(panel).toContainText(answer);
      await expect(panel.getByRole("status")).toContainText(
        "Saved. Indexing runs in the background.",
      );
      await expect(panel).toContainText("Answered");
      await expect(panel.getByRole("button", { name: "Edit answer" })).toBeVisible();
      await page.waitForURL((url) => !url.searchParams.has("write"));
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(panel).toBeHidden();
      // Answered, so it has left the open view for the resolved one.
      await expect(rowOf(page, A.label)).toHaveCount(0);
      await page.goto("/gaps?status=resolved");
      await expect(rowOf(page, A.label)).toContainText("Answered");

      await page.goto("/sources/answers");
      const pair = page.getByRole("row").filter({ hasText: answer });
      await expect(pair).toContainText(A.label);
      await expect(pair.getByRole("link", { name: A.label })).toHaveAttribute(
        "href",
        `/gaps?gap=${A.id}`,
      );
      await expect(pair).toContainText("Resolved");
    } finally {
      const [row] = await db
        .select({ documentId: gapClusters.correctionDocumentId })
        .from(gapClusters)
        .where(eq(gapClusters.id, A.id));
      await db
        .update(gapClusters)
        .set({ status: "open", resolvedAt: null, resolvedBy: null, correctionDocumentId: null })
        .where(eq(gapClusters.id, A.id));
      if (row?.documentId) await db.delete(documents).where(eq(documents.id, row.documentId));
      await db.$client.end();
    }
  });

  // Last: it marks clusters as requested, and the phone project reruns this
  // file against the same seed, so the marks are cleared before it ends.
  test("clicking Analyze confirms the request at once", async ({ page }) => {
    const db = createDb(e2eDatabaseUrl());
    try {
      await page.getByRole("button", { name: "Analyze 3 open" }).click();
      const bar = page.getByRole("status");
      await expect(bar).toContainText(/Requesting analysis for 3 clusters|Analyzing 3 clusters/);
      await expect(bar).toContainText("Analyzing 3 clusters… 0 of 3 done");
      await expect(rowOf(page, B.label)).toContainText("Analyzing…");
      await expect(page.getByRole("button", { name: "Analyze 3 open" })).toHaveCount(0);
    } finally {
      await db
        .update(gapClusters)
        .set({ analysisRequestedAt: null, analysisRequestedBy: null })
        .where(inArray(gapClusters.id, [B.id, C.id, E.id]));
      await db.$client.end();
    }
  });
});
