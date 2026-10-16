import { expect, test } from "@playwright/test";
import {
  allowHostOrigin,
  openHost,
  recordedEvents,
  resetHostState,
  stubAsk,
  stubAskFrames,
  stubFeedback,
} from "./host";

test.describe("asking from a host page", () => {
  test.beforeAll(allowHostOrigin);
  test.afterAll(resetHostState);

  test("streams a Markdown answer with typed citations, takes a vote, reports events", async ({
    page,
  }) => {
    await stubAsk(page, {
      text: "Open **Settings**, then:\n1. Install\n2. Done",
      citations: [
        {
          documentId: "doc_1",
          title: "Install guide",
          url: "https://docs.example.test/install",
          snippet: "Install …",
          kind: "docs-crawler",
        },
      ],
    });
    const posted = await stubFeedback(page);
    await openHost(page);

    await page.getByRole("button", { name: "Open help" }).click();
    const dialog = page.getByRole("dialog", { name: "Help" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Ask a question…" }).fill("How do I install?");
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.locator("strong", { hasText: "Settings" })).toBeVisible();
    await expect(dialog.locator("ol li")).toHaveCount(2);
    const pill = dialog.locator('[part~="citation-kind-docs-crawler"]');
    await expect(pill).toHaveText("Install guide");
    await expect(pill).toHaveAttribute("href", "https://docs.example.test/install");

    await dialog.getByRole("button", { name: "Good answer" }).click();
    await expect.poll(() => posted().length).toBe(1);
    expect(posted()[0]).toMatchObject({ messageId: "msg_stub", feedback: "up" });

    const events = await recordedEvents(page);
    const answer = events.find((e) => e.name === "answer")?.detail as Record<string, unknown>;
    expect(answer).toMatchObject({ question: "How do I install?", messageId: "msg_stub" });
    expect(String(answer.answer)).toContain("Open **Settings**");
    expect(events.some((e) => e.name === "ready")).toBe(true);
  });

  test("offers a clarifying question's options and asks the one tapped", async ({ page }) => {
    // The server asked which reading was meant (spec: clarifying-questions);
    // the pick goes back as the next message in the same conversation.
    await stubAskFrames(page, [
      [
        {
          type: "clarify",
          question: "Configure what?",
          options: ["Theming the widget", "Installing Deskbell"],
        },
        { type: "done", conversationId: "conv_stub", messageId: "msg_ask" },
      ],
      [
        { type: "token", value: "Set the custom properties." },
        { type: "done", conversationId: "conv_stub", messageId: "msg_answer" },
      ],
    ]);
    const asked: unknown[] = [];
    await page.route("**/api/v1/ask", (route) => {
      if (route.request().method() === "POST") asked.push(route.request().postDataJSON());
      void route.fallback();
    });
    await openHost(page);

    await page.getByRole("button", { name: "Open help" }).click();
    const dialog = page.getByRole("dialog", { name: "Help" });
    await dialog.getByRole("textbox", { name: "Ask a question…" }).fill("How do I configure it?");
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.getByText("Configure what?")).toBeVisible();
    const options = dialog.locator('[part="clarify-option"]');
    await expect(options).toHaveCount(2);
    await options.filter({ hasText: "Theming the widget" }).click();

    await expect(dialog.getByText("Set the custom properties.")).toBeVisible();
    await expect(options).toHaveCount(0);
    expect(asked.at(-1)).toMatchObject({
      message: "Theming the widget",
      conversationId: "conv_stub",
    });

    const events = await recordedEvents(page);
    const clarify = events.find((e) => e.name === "clarify")?.detail as Record<string, unknown>;
    expect(clarify).toMatchObject({ question: "How do I configure it?", asked: "Configure what?" });
    expect(events.filter((e) => e.name === "answer")).toHaveLength(1);
  });
});
