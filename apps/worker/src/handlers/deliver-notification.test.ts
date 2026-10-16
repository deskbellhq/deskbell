import type {
  NotificationChannelId,
  NotificationEvent,
  ProjectNotifications,
} from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import type { Channels, DeliveryResult } from "../notifications/channels";
import { RetryableDeliveryError } from "../notifications/channels/types";
import { type DeliverDeps, deliverNotification } from "./deliver-notification";

const event: NotificationEvent = {
  id: "ntf_1",
  type: "feedback.negative",
  version: 1,
  createdAt: "2026-09-18T10:00:00.000Z",
  project: { id: "proj_1", name: "Docs" },
  url: "https://deskbell.example/conversations/conv_1",
  data: {
    conversation: { id: "conv_1", title: null, context: null },
    message: { id: "msg_1", createdAt: "2026-09-18T09:59:00.000Z", question: "q", answer: "a" },
    feedback: { reason: null, reasonLabel: null, comment: null },
    summary: { text: "q", source: "question" },
  },
};

const both: Partial<ProjectNotifications> = {
  channels: {
    slack: { webhookUrl: "https://hooks.slack.com/x" },
    webhook: { url: "https://r.example/hook", signingSecret: "whsec_0123456789abcdef" },
  },
};

function fake(
  opts: {
    settings?: Partial<ProjectNotifications> | null;
    delivered?: NotificationChannelId[];
    build?: "event" | "missing" | "withdrawn";
    slack?: DeliveryResult | "retry";
    webhook?: DeliveryResult | "retry";
  } = {},
) {
  const sent: string[] = [];
  const recorded: Array<{ channel: string; status: string }> = [];
  const outcome = (
    r: DeliveryResult | "retry" | undefined,
    id: string,
  ): Promise<DeliveryResult> => {
    sent.push(id);
    if (r === "retry") throw new RetryableDeliveryError(`${id}: 503`);
    return Promise.resolve(r ?? { status: "delivered" });
  };
  const channels = {
    slack: { id: "slack", render: () => ({}), deliver: () => outcome(opts.slack, "slack") },
    webhook: {
      id: "webhook",
      render: (e: NotificationEvent) => e,
      deliver: () => outcome(opts.webhook, "webhook"),
    },
  } as unknown as Channels;
  const deps: DeliverDeps = {
    async settings() {
      return opts.settings === undefined ? both : opts.settings;
    },
    async build() {
      const b = opts.build ?? "event";
      return b === "event" ? { event } : { event: null, reason: b };
    },
    channels,
    async delivered() {
      return new Set(opts.delivered ?? []);
    },
    async record({ channel, result }) {
      recorded.push({ channel, status: result.status });
    },
  };
  return { deps, sent, recorded };
}

const job = {
  orgId: "org_1",
  projectId: "proj_1",
  event: "feedback.negative" as const,
  subject: { messageId: "msg_1", conversationId: "conv_1" },
  baseUrl: "https://deskbell.example",
};

describe("deliverNotification", () => {
  it("sends through every configured channel and records each", async () => {
    const f = fake();
    const r = await deliverNotification(f.deps, job);
    expect(r.outcome).toBe("sent");
    expect(f.sent).toEqual(["slack", "webhook"]);
    expect(f.recorded).toEqual([
      { channel: "slack", status: "delivered" },
      { channel: "webhook", status: "delivered" },
    ]);
  });

  it("skips channels already delivered, and is a no-op when all are", async () => {
    const f = fake({ delivered: ["slack"] });
    expect((await deliverNotification(f.deps, job)).outcome).toBe("sent");
    expect(f.sent).toEqual(["webhook"]);
    const g = fake({ delivered: ["slack", "webhook"] });
    expect((await deliverNotification(g.deps, job)).outcome).toBe("already");
    expect(g.sent).toEqual([]);
  });

  it("does nothing when unconfigured, withdrawn or missing", async () => {
    expect((await deliverNotification(fake({ settings: {} }).deps, job)).outcome).toBe(
      "unconfigured",
    );
    expect((await deliverNotification(fake({ build: "withdrawn" }).deps, job)).outcome).toBe(
      "withdrawn",
    );
    expect((await deliverNotification(fake({ build: "missing" }).deps, job)).outcome).toBe(
      "missing",
    );
    expect((await deliverNotification(fake().deps, { ...job, subject: {} })).outcome).toBe(
      "missing",
    );
  });

  it("records a rejection and does not throw for it", async () => {
    const f = fake({ webhook: { status: "rejected", error: "r.example: 404" } });
    expect((await deliverNotification(f.deps, job)).outcome).toBe("partial");
    expect(f.recorded).toEqual([
      { channel: "slack", status: "delivered" },
      { channel: "webhook", status: "rejected" },
    ]);
    const g = fake({
      slack: { status: "rejected", error: "x" },
      webhook: { status: "rejected", error: "y" },
    });
    expect((await deliverNotification(g.deps, job)).outcome).toBe("rejected");
  });

  it("rethrows a retryable failure after recording the channel that succeeded", async () => {
    const f = fake({ webhook: "retry" });
    await expect(deliverNotification(f.deps, job)).rejects.toThrow(RetryableDeliveryError);
    expect(f.recorded).toEqual([{ channel: "slack", status: "delivered" }]);
  });
});
