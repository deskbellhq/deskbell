import { type NotificationEvent, verifyNotificationSignature } from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import { classify, postJson } from "./http";
import { createSlackChannel, slackEscape, slackMessage, slackMessageFromTemplate } from "./slack";
import { RetryableDeliveryError } from "./types";
import { webhookHeaders } from "./webhook";

const event: NotificationEvent = {
  id: "ntf_1",
  type: "feedback.negative",
  version: 1,
  createdAt: "2026-09-18T10:00:00.000Z",
  project: { id: "proj_1", name: "Docs & Help" },
  url: "https://deskbell.example/conversations/conv_1",
  data: {
    conversation: {
      id: "conv_1",
      title: "Exports",
      context: { site: { id: "42", name: "Shop <A&B>" }, account: { id: "7" } },
    },
    message: {
      id: "msg_1",
      createdAt: "2026-09-18T09:59:00.000Z",
      question: "How do I <export> a feed?",
      answer: "Open the menu.",
    },
    feedback: { reason: "incorrect", reasonLabel: "Inaccurate", comment: "<https://evil|Open>" },
    summary: { text: "The answer named the wrong menu.", source: "model" },
  },
};

describe("slackMessage", () => {
  it("escapes visitor text and lays out the blocks", () => {
    const msg = slackMessage(event);
    expect(msg.text).toContain("Negative feedback on Docs & Help");
    const json = JSON.stringify(msg.blocks);
    expect(json).not.toContain("<https://evil|Open>");
    expect(json).toContain("&lt;https://evil|Open&gt;");
    expect(json).toContain("How do I &lt;export&gt; a feed?");
    expect(json).toContain("Shop &lt;A&amp;B&gt;");
    const types = msg.blocks.map((b) => b.type);
    expect(types).toEqual([
      "header",
      "section",
      "section",
      "section",
      "section",
      "actions",
      "context",
    ]);
    const button = (msg.blocks[5] as { elements: Array<{ url: string }> }).elements[0];
    expect(button?.url).toBe(event.url);
  });

  it("omits the context block when there is none and clips a long question", () => {
    const msg = slackMessage({
      ...event,
      data: {
        ...event.data,
        conversation: { ...event.data.conversation, context: null },
        message: { ...event.data.message, question: "q".repeat(900) },
      },
    });
    expect(msg.blocks.map((b) => b.type)).toEqual([
      "header",
      "section",
      "section",
      "section",
      "actions",
      "context",
    ]);
    const quote = (msg.blocks[1] as { text: { text: string } }).text.text;
    expect(quote.length).toBeLessThanOrEqual(2 + 500);
    expect(quote.endsWith("…")).toBe(true);
  });

  it("renders a custom template as one section plus the button, values escaped", () => {
    const msg = slackMessageFromTemplate(
      event,
      "*{project.name}*\n{question}\n{context.site.name} / {context.nope.id}|{comment}",
    );
    const section = (msg.blocks[0] as { text: { text: string } }).text.text;
    expect(section).toBe(
      "*Docs &amp; Help*\nHow do I &lt;export&gt; a feed?\nShop &lt;A&amp;B&gt; / |&lt;https://evil|Open&gt;",
    );
    expect(msg.blocks.map((b) => b.type)).toEqual(["section", "actions"]);
    expect(msg.text.startsWith("Docs &amp; Help")).toBe(true);
    const channel = createSlackChannel();
    expect(
      (
        channel.render(event, {
          webhookUrl: "https://h",
          templates: { "feedback.negative": " " },
        }) as { blocks: unknown[] }
      ).blocks,
    ).toHaveLength(7);
    expect(
      (
        channel.render(event, {
          webhookUrl: "https://h",
          templates: { "feedback.negative": "{question}" },
        }) as { blocks: unknown[] }
      ).blocks,
    ).toHaveLength(2);
  });

  it("escapes the three mrkdwn characters and nothing else", () => {
    expect(slackEscape("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("webhookHeaders", () => {
  it("signs the body so the shared verifier accepts it", async () => {
    const body = JSON.stringify(event);
    const headers = await webhookHeaders(event, body, "whsec_test", 1_700_000_000_000);
    expect(headers["x-deskbell-event"]).toBe("feedback.negative");
    expect(headers["x-deskbell-delivery"]).toBe("ntf_1");
    expect(
      await verifyNotificationSignature({
        secret: "whsec_test",
        timestamp: headers["x-deskbell-timestamp"] ?? "",
        body,
        header: headers["x-deskbell-signature"] ?? "",
        now: 1_700_000_000_000,
      }),
    ).toBe(true);
  });
});

describe("postJson", () => {
  it("maps statuses: 2xx delivered, 4xx rejected, 5xx and 429 retryable", () => {
    expect(classify(200, "h")).toEqual({ status: "delivered" });
    expect(classify(404, "h")).toEqual({ status: "rejected", error: "h: 404" });
    expect(classify(302, "h")).toEqual({ status: "rejected", error: "h: 302" });
    expect(() => classify(503, "h")).toThrow(RetryableDeliveryError);
    expect(() => classify(429, "h")).toThrow(RetryableDeliveryError);
  });

  it("refuses an invalid URL without a request and never follows redirects", async () => {
    let called = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      called += 1;
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await postJson("https://10.0.0.1/x", "{}", {}, fetchImpl)).toMatchObject({
      status: "rejected",
    });
    expect(called).toBe(0);
    expect(await postJson("https://hooks.example/x", "{}", {}, fetchImpl)).toEqual({
      status: "delivered",
    });
    expect(called).toBe(1);
  });

  it("turns a network failure into a retryable error naming the host only", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      postJson("https://hooks.example/secret-path", "{}", {}, fetchImpl),
    ).rejects.toThrow(/^hooks.example: TypeError$/);
  });
});
