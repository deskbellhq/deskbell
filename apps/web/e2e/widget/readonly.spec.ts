import { expect, test } from "@playwright/test";
import { WIDGET } from "../seed";
import { allowHostOrigin, openHost, recordedEvents, resetHostState, signToken } from "./host";

test.describe("staff preview", () => {
  test.beforeAll(allowHostOrigin);
  test.afterAll(resetHostState);

  const attrs = { readonly: "", "conversation-id": WIDGET.threads.v2.id };

  test("opens another visitor's thread read-only for a token with the staff claim", async ({
    page,
  }) => {
    const token = await signToken({ sub: "staff-1", roles: ["support"] });
    await openHost(page, { attrs, token, style: "display:block;height:600px" });
    const dialog = page.getByRole("dialog", { name: "Help" });
    await expect(dialog.getByText("Here is how rule boxes works.")).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Good answer" })).toBeDisabled();
    const events = await recordedEvents(page);
    const preview = events.find((e) => e.name === "preview")?.detail as Record<string, unknown>;
    expect(preview).toMatchObject({
      conversationId: WIDGET.threads.v2.id,
      title: "Rule boxes",
      owner: { name: "Visitor Two", email: "two@e2e.test" },
    });
  });

  test("refuses a token without the claim", async ({ page }) => {
    const token = await signToken({ sub: WIDGET.visitors.one.subject });
    await openHost(page, { attrs, token, style: "display:block;height:600px" });
    await expect(page.getByText("You don't have access to this conversation.")).toBeVisible();
  });
});
