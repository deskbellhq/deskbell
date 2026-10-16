import { describe, expect, it } from "vitest";
import {
  channelsFor,
  conversationUrl,
  DEFAULT_SLACK_TEMPLATES,
  NotificationEventSchema,
  notificationDeliveryId,
  ProjectNotificationsSchema,
  renderTemplate,
  templateValues,
  validateLinkTemplate,
  validateMessageTemplate,
} from "./notifications";

describe("ProjectNotificationsSchema", () => {
  it("accepts an empty document and a fully configured one", () => {
    expect(ProjectNotificationsSchema.parse({})).toEqual({});
    const full = ProjectNotificationsSchema.parse({
      channels: {
        slack: {
          webhookUrl: "https://hooks.slack.com/services/x",
          events: { "feedback.negative": true },
        },
        webhook: { url: "https://r.example/hook", signingSecret: "whsec_0123456789abcdef" },
      },
      conversationLinkTemplate: "https://app.example/threads/{conversationId}",
    });
    expect(full.channels?.webhook?.signingSecret).toBe("whsec_0123456789abcdef");
  });

  it("rejects a webhook without a secret and unknown events", () => {
    expect(
      ProjectNotificationsSchema.safeParse({ channels: { webhook: { url: "https://r.example" } } })
        .success,
    ).toBe(false);
    expect(
      ProjectNotificationsSchema.safeParse({
        channels: { slack: { webhookUrl: "https://h.example", events: { nope: true } } },
      }).success,
    ).toBe(false);
  });
});

describe("channelsFor", () => {
  it("lists channels with a target whose toggle is not off", () => {
    expect(channelsFor(undefined, "feedback.negative")).toEqual([]);
    expect(
      channelsFor(
        {
          channels: {
            slack: { webhookUrl: "https://h.example", events: { "feedback.negative": false } },
            webhook: { url: "https://r.example", signingSecret: "whsec_0123456789abcdef" },
          },
        },
        "feedback.negative",
      ),
    ).toEqual(["webhook"]);
    expect(
      channelsFor(
        { channels: { slack: { webhookUrl: "https://h.example" } } },
        "feedback.negative",
      ),
    ).toEqual(["slack"]);
  });
});

describe("conversationUrl", () => {
  const base = { baseUrl: "https://deskbell.example/", conversationId: "conv_1" };
  it("defaults to the dashboard page", () => {
    expect(conversationUrl(base)).toBe("https://deskbell.example/conversations/conv_1");
  });
  it("fills placeholders, encoded, and falls back when one is missing", () => {
    const context = { site: { id: "42", name: "Shop & Co" } };
    expect(
      conversationUrl({
        ...base,
        context,
        template:
          "https://app.example/sites/{context.site.id}/chat/{conversationId}?n={context.site.name}",
      }),
    ).toBe("https://app.example/sites/42/chat/conv_1?n=Shop%20%26%20Co");
    expect(
      conversationUrl({ ...base, context, template: "https://app.example/{context.account.id}" }),
    ).toBe("https://deskbell.example/conversations/conv_1");
  });
});

describe("validateLinkTemplate", () => {
  it("accepts known placeholders and rejects the rest", () => {
    expect(validateLinkTemplate("https://a.example/{conversationId}").ok).toBe(true);
    expect(validateLinkTemplate("https://a.example/{context.site.id}/x").ok).toBe(true);
    expect(validateLinkTemplate("https://a.example/{thread}").ok).toBe(false);
    expect(validateLinkTemplate("/relative/{conversationId}").ok).toBe(false);
    expect(validateLinkTemplate("").ok).toBe(false);
  });
});

describe("NotificationEventSchema", () => {
  it("round-trips a feedback.negative event", () => {
    const event = {
      id: "ntf_1",
      type: "feedback.negative",
      version: 1,
      createdAt: "2026-09-18T10:00:00.000Z",
      project: { id: "proj_1", name: "Docs" },
      url: "https://deskbell.example/conversations/conv_1",
      data: {
        conversation: { id: "conv_1", title: "Exports", context: { site: { id: "42" } } },
        message: { id: "msg_1", createdAt: "2026-09-18T09:59:00.000Z", question: "q", answer: "a" },
        feedback: { reason: "incorrect", reasonLabel: "Inaccurate", comment: null },
        summary: { text: "The answer named the wrong menu.", source: "model" },
      },
    };
    expect(NotificationEventSchema.parse(event)).toEqual(event);
  });
});

describe("notificationDeliveryId", () => {
  it("is stable for a subject and differs across subjects", async () => {
    const a = await notificationDeliveryId({
      projectId: "p",
      event: "feedback.negative",
      subjectKey: "msg_1",
    });
    expect(a).toBe(
      await notificationDeliveryId({
        projectId: "p",
        event: "feedback.negative",
        subjectKey: "msg_1",
      }),
    );
    expect(a).toMatch(/^ntf_[0-9a-f]{32}$/);
    expect(a).not.toBe(
      await notificationDeliveryId({
        projectId: "p",
        event: "feedback.negative",
        subjectKey: "msg_2",
      }),
    );
  });
});

describe("message templates", () => {
  const event = NotificationEventSchema.parse({
    id: "ntf_1",
    type: "feedback.negative",
    version: 1,
    createdAt: "2026-09-18T10:00:00.000Z",
    project: { id: "proj_1", name: "Docs" },
    url: "https://d.example/conversations/conv_1",
    data: {
      conversation: {
        id: "conv_1",
        title: null,
        context: { site: { id: "42", name: "Shop <A>" } },
      },
      message: { id: "msg_1", createdAt: "2026-09-18T09:59:00.000Z", question: "q?", answer: "a" },
      feedback: { reason: "incorrect", reasonLabel: "Inaccurate", comment: null },
      summary: { text: "s", source: "question" },
    },
  });

  it("flattens the event into values and renders with escaping", () => {
    const values = templateValues(event);
    expect(values["context.site.name"]).toBe("Shop <A>");
    expect(values.context).toBe("site: Shop <A> (42)");
    expect(values.comment).toBe("");
    expect(values["conversation.title"]).toBe("");
    const esc = (t: string) => t.replaceAll("<", "&lt;");
    expect(
      renderTemplate(
        "{event.label}: {question} at {context.site.name} {context.nope.id}|",
        values,
        esc,
      ),
    ).toBe("Negative feedback: q? at Shop &lt;A> |");
  });

  it("validates placeholders at save time and ships a usable default", () => {
    expect(validateMessageTemplate("feedback.negative", "{question} {context.site.id}").ok).toBe(
      true,
    );
    expect(validateMessageTemplate("feedback.negative", "{questions}")).toMatchObject({
      ok: false,
      reason: "Unknown placeholder {questions}.",
    });
    expect(validateMessageTemplate("feedback.negative", "").ok).toBe(false);
    expect(
      validateMessageTemplate("feedback.negative", DEFAULT_SLACK_TEMPLATES["feedback.negative"]).ok,
    ).toBe(true);
    expect(
      ProjectNotificationsSchema.safeParse({
        channels: {
          slack: { webhookUrl: "https://h.example", templates: { "feedback.negative": "x" } },
        },
      }).success,
    ).toBe(true);
  });
});
