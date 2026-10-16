import { expect, test } from "@playwright/test";
import { allowHostOrigin, openHost, recordedEvents, resetHostState, stubAskFrames } from "./host";

/**
 * Actions in the widget (spec: mcp-actions, action-presentation): the step
 * line above an answer, the confirmation card, and the approval the widget
 * posts when the visitor decides. The ask endpoint is stubbed; what is exercised is the widget's
 * side of the contract and the exact request it sends back.
 */
test.describe("actions from a host page", () => {
  test.beforeAll(allowHostOrigin);
  test.afterAll(resetHostState);

  test("shows a step line, keeps the tool out of Sources, and confirms a card", async ({
    page,
  }) => {
    const done = { type: "done", conversationId: "conv_stub", messageId: "msg_stub" };
    const posted = await stubAskFrames(page, [
      [
        { type: "action", id: "act_1", title: "Look up your order", status: "running" },
        { type: "action", id: "act_1", title: "Look up your order", status: "succeeded" },
        { type: "token", value: "Your order shipped yesterday." },
        {
          type: "citations",
          citations: [
            {
              documentId: "action:act_1",
              title: "Look up your order",
              snippet: "shipped",
              kind: "action",
            },
          ],
        },
        done,
      ],
      [
        {
          type: "confirm",
          id: "act_2",
          title: "Cancel your order",
          summary: "Cancel your order — id: 42",
          details: [{ label: "Order ID", value: "42" }],
          input: { id: "42" },
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
        done,
      ],
      [
        { type: "action", id: "act_2", title: "Cancel your order", status: "succeeded" },
        { type: "token", value: "Done, order 42 is cancelled." },
        done,
      ],
    ]);
    await openHost(page, { attrs: { mode: "inline" }, style: "display:block;height:600px" });
    const dialog = page.getByRole("dialog", { name: "Help" });
    const input = dialog.getByRole("textbox", { name: "Ask a question…" });

    await input.fill("Where is my order?");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByText("Your order shipped yesterday.")).toBeVisible();
    const step = dialog.locator('[part="action"]').first();
    await expect(step.locator('[part="action-title"]')).toHaveText("Look up your order");
    // The check mark carries the state; the word is there for screen readers only.
    await expect(step.locator('[part="action-status"]')).toHaveText("Done");
    await expect(step.locator('[part="action-status"]')).toHaveClass(/sr-only/);
    await expect(dialog.locator('[part="citations"]')).toHaveCount(0);

    await input.fill("Cancel order 42");
    await dialog.getByRole("button", { name: "Send" }).click();
    const card = dialog.locator('[part="action-card"]');
    await expect(card.getByText("Confirm to continue")).toBeVisible();
    await expect(card.locator('[part="action-title"]')).toHaveText("Cancel your order");
    await expect(card.locator("dt")).toHaveText("Order ID");
    await expect(card.locator("dd")).toHaveText("42");
    await expect(dialog.getByText("id: 42")).toHaveCount(0);
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByText("Done, order 42 is cancelled.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await expect(card).toHaveCount(0);
    // The call is one step line, on the message that asked — not repeated under the answer.
    const cancelled = dialog.locator('[part="action"]', { hasText: "Cancel your order" });
    await expect(cancelled).toHaveCount(1);
    await expect(cancelled).toHaveClass(/succeeded/);

    expect(posted()).toHaveLength(3);
    expect(posted()[2]).toMatchObject({
      message: "",
      conversationId: "conv_stub",
      approval: { callId: "act_2", approved: true },
    });
    const events = await recordedEvents(page);
    expect(
      events.filter((e) => e.name === "action").map((e) => (e.detail as { status: string }).status),
    ).toEqual(["running", "succeeded", "succeeded"]);
    expect(events.filter((e) => e.name === "confirm").map((e) => e.detail)).toEqual([
      {
        id: "act_2",
        title: "Cancel your order",
        summary: "Cancel your order — id: 42",
        details: [{ label: "Order ID", value: "42" }],
      },
      { id: "act_2", approved: true, conversationId: "conv_stub" },
    ]);
  });
});
