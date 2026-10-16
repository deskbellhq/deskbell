import type { ProjectNotifications } from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import {
  mergeNotificationSettings,
  type NotificationsFormInput,
  notificationsView,
} from "./settings";

const stored: ProjectNotifications = {
  channels: {
    slack: {
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      events: { "feedback.negative": false },
    },
    webhook: { url: "https://r.example/hook", signingSecret: "whsec_0123456789abcdef" },
  },
  conversationLinkTemplate: "https://app.example/{conversationId}",
};

const blank: NotificationsFormInput = {
  slackUrl: "",
  slackRemove: false,
  slackEvents: { "feedback.negative": true },
  slackTemplates: {},
  webhookUrl: "",
  webhookRemove: false,
  webhookEvents: { "feedback.negative": true },
  conversationLinkTemplate: "https://app.example/{conversationId}",
};

describe("notificationsView", () => {
  it("masks targets and never carries the stored values", () => {
    const v = notificationsView(stored, {
      slack: { status: "delivered", at: "2026-09-18T10:00:00.000Z", error: null },
    });
    expect(v.slack).toEqual({
      configured: true,
      masked: "https://hooks.slack.com/…",
      events: { "feedback.negative": false },
      lastDelivery: { status: "delivered", at: "2026-09-18T10:00:00.000Z", error: null },
      templates: {},
    });
    expect(v.webhook.secretMasked).toBe("whsec_0123…");
    expect(JSON.stringify(v)).not.toContain("services/T/B/x");
    expect(JSON.stringify(v)).not.toContain("0123456789abcdef");
    expect(notificationsView(undefined).slack.configured).toBe(false);
  });
});

describe("mergeNotificationSettings", () => {
  const secret = () => "whsec_newnewnewnewnewnew";

  it("keeps stored targets when fields are empty and applies the toggles", () => {
    const r = mergeNotificationSettings(stored, blank, secret);
    expect(r).toMatchObject({ ok: true, revealedSecret: null });
    if (!r.ok) throw new Error();
    expect(r.settings.channels?.slack).toEqual({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      events: { "feedback.negative": true },
    });
    expect(r.settings.channels?.webhook?.signingSecret).toBe("whsec_0123456789abcdef");
  });

  it("replaces, removes, and mints a secret for a first webhook", () => {
    const r = mergeNotificationSettings(
      stored,
      { ...blank, slackUrl: "https://hooks.slack.com/services/T/B/y", webhookRemove: true },
      secret,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.settings.channels?.slack?.webhookUrl).toBe("https://hooks.slack.com/services/T/B/y");
    expect(r.settings.channels?.webhook).toBeUndefined();

    const first = mergeNotificationSettings(
      {},
      { ...blank, webhookUrl: "https://r.example/new" },
      secret,
    );
    if (!first.ok) throw new Error(first.error);
    expect(first.revealedSecret).toBe("whsec_newnewnewnewnewnew");
    expect(first.settings.channels?.webhook?.signingSecret).toBe("whsec_newnewnewnewnewnew");
  });

  it("keeps a Slack message template and rejects an unknown placeholder", () => {
    const r = mergeNotificationSettings(
      stored,
      { ...blank, slackTemplates: { "feedback.negative": " *{question}* " } },
      secret,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.settings.channels?.slack?.templates).toEqual({ "feedback.negative": "*{question}*" });
    expect(notificationsView(r.settings).slack.templates).toEqual({
      "feedback.negative": "*{question}*",
    });
    expect(
      mergeNotificationSettings(
        stored,
        { ...blank, slackTemplates: { "feedback.negative": "{nope}" } },
        secret,
      ),
    ).toMatchObject({ ok: false, error: "Slack message: Unknown placeholder {nope}." });
  });

  it("rejects a bad URL or template with a channel-prefixed message", () => {
    expect(
      mergeNotificationSettings({}, { ...blank, slackUrl: "http://hooks.example" }, secret),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Slack: /),
    });
    expect(
      mergeNotificationSettings(
        {},
        { ...blank, conversationLinkTemplate: "https://a/{nope}" },
        secret,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Link template: /),
    });
  });

  it("clears everything when nothing is configured", () => {
    const r = mergeNotificationSettings(
      stored,
      { ...blank, slackRemove: true, webhookRemove: true, conversationLinkTemplate: "" },
      secret,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.settings).toEqual({});
  });
});
