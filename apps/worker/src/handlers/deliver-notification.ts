import type { FeedbackSummarizer } from "@deskbell/core/models";
import { type Database, notificationDeliveries, projects } from "@deskbell/db";
import {
  channelsFor,
  type DeliverNotificationJob,
  type NotificationChannelId,
  type NotificationEvent,
  type NotificationEventType,
  newId,
  type ProjectNotifications,
} from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { type Channels, createChannels, type DeliveryResult } from "../notifications/channels";
import { RetryableDeliveryError } from "../notifications/channels/types";
import {
  type BuildOutcome,
  buildFeedbackNegative,
  createFeedbackNegativeDeps,
} from "../notifications/events/feedback-negative";

/**
 * notifications.deliver (spec: project-notifications): build the event from
 * its subject, then render and deliver it through every channel the project
 * has it switched on for, recording each channel's outcome. A channel
 * already delivered for this subject is skipped, so a retry after a partial
 * failure re-sends only what failed. Retryable failures rethrow after the
 * successes are recorded; a rejection is recorded and not retried.
 */

export interface DeliverDeps {
  settings(): Promise<Partial<ProjectNotifications> | null>;
  build(
    event: NotificationEventType,
    subject: Record<string, string>,
    baseUrl: string,
  ): Promise<BuildOutcome>;
  channels: Channels;
  delivered(event: NotificationEventType, subjectKey: string): Promise<Set<NotificationChannelId>>;
  record(input: {
    event: NotificationEventType;
    subjectKey: string;
    channel: NotificationChannelId;
    result: DeliveryResult;
  }): Promise<void>;
}

export type DeliverOutcome =
  | "sent"
  | "partial"
  | "already"
  | "withdrawn"
  | "missing"
  | "unconfigured"
  | "rejected";

/** What the subject is keyed by in the deliveries table. */
export function subjectKeyOf(
  event: NotificationEventType,
  subject: Record<string, string>,
): string {
  switch (event) {
    case "feedback.negative":
      return subject.messageId ?? "";
    default:
      return unreachable(event);
  }
}

function unreachable(type: never): never {
  throw new Error(`no subject key for event ${String(type)}`);
}

export async function deliverNotification(
  deps: DeliverDeps,
  job: DeliverNotificationJob,
): Promise<{
  outcome: DeliverOutcome;
  perChannel: Partial<Record<NotificationChannelId, string>>;
}> {
  const perChannel: Partial<Record<NotificationChannelId, string>> = {};
  const subjectKey = subjectKeyOf(job.event, job.subject);
  if (!subjectKey) return { outcome: "missing", perChannel };

  const settings = await deps.settings();
  const wanted = channelsFor(settings, job.event);
  if (wanted.length === 0) return { outcome: "unconfigured", perChannel };

  const done = await deps.delivered(job.event, subjectKey);
  const pending = wanted.filter((c) => !done.has(c));
  if (pending.length === 0) return { outcome: "already", perChannel };

  const built = await deps.build(job.event, job.subject, job.baseUrl);
  if (!built.event) return { outcome: built.reason, perChannel };

  let retryable: Error | null = null;
  let rejected = 0;
  let delivered = 0;
  for (const channel of pending) {
    try {
      const result = await sendThrough(deps.channels, channel, settings, built.event);
      await deps.record({ event: job.event, subjectKey, channel, result });
      perChannel[channel] = result.status;
      if (result.status === "delivered") delivered += 1;
      else rejected += 1;
    } catch (error) {
      if (!(error instanceof RetryableDeliveryError)) throw error;
      perChannel[channel] = "retry";
      retryable ??= error;
    }
  }
  if (retryable) throw retryable;
  if (delivered === 0) return { outcome: "rejected", perChannel };
  return { outcome: rejected > 0 ? "partial" : "sent", perChannel };
}

function sendThrough(
  channels: Channels,
  channel: NotificationChannelId,
  settings: Partial<ProjectNotifications> | null,
  event: NotificationEvent,
): Promise<DeliveryResult> {
  switch (channel) {
    case "slack": {
      const target = settings?.channels?.slack;
      if (!target) return Promise.resolve({ status: "rejected", error: "slack: no target" });
      return channels.slack.deliver(target, channels.slack.render(event, target), event);
    }
    case "webhook": {
      const target = settings?.channels?.webhook;
      if (!target) return Promise.resolve({ status: "rejected", error: "webhook: no target" });
      return channels.webhook.deliver(target, channels.webhook.render(event, target), event);
    }
    default:
      return unreachableChannel(channel);
  }
}

function unreachableChannel(channel: never): never {
  throw new Error(`no channel ${String(channel)}`);
}

export function createDeliverDeps(
  db: Database,
  summarizer: FeedbackSummarizer | null,
  scope: { orgId: string; projectId: string },
  channels: Channels = createChannels(),
): DeliverDeps {
  const inProject = and(
    eq(notificationDeliveries.orgId, scope.orgId),
    eq(notificationDeliveries.projectId, scope.projectId),
  );
  return {
    async settings() {
      const [row] = await db
        .select({ notifications: projects.notifications })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.orgId, scope.orgId)))
        .limit(1);
      return row?.notifications ?? null;
    },
    build(event, subject, baseUrl) {
      switch (event) {
        case "feedback.negative":
          return buildFeedbackNegative(
            createFeedbackNegativeDeps(db, summarizer, scope),
            subject,
            baseUrl,
          );
        default:
          return unreachable(event);
      }
    },
    channels,
    async delivered(event, subjectKey) {
      const rows = await db
        .select({ channel: notificationDeliveries.channel })
        .from(notificationDeliveries)
        .where(
          and(
            inProject,
            eq(notificationDeliveries.event, event),
            eq(notificationDeliveries.subjectKey, subjectKey),
            eq(notificationDeliveries.status, "delivered"),
          ),
        );
      return new Set(rows.map((r) => r.channel as NotificationChannelId));
    },
    async record({ event, subjectKey, channel, result }) {
      const now = new Date();
      await db
        .insert(notificationDeliveries)
        .values({
          id: newId("ntd"),
          orgId: scope.orgId,
          projectId: scope.projectId,
          event,
          subjectKey,
          channel,
          status: result.status,
          deliveredAt: result.status === "delivered" ? now : null,
          error: result.status === "rejected" ? result.error : null,
        })
        .onConflictDoUpdate({
          target: [
            notificationDeliveries.projectId,
            notificationDeliveries.event,
            notificationDeliveries.subjectKey,
            notificationDeliveries.channel,
          ],
          set: {
            status: result.status,
            deliveredAt: result.status === "delivered" ? now : null,
            error: result.status === "rejected" ? result.error : null,
            updatedAt: now,
          },
        });
    },
  };
}

export async function handleDeliverNotification(
  db: Database,
  summarizer: FeedbackSummarizer | null,
  job: DeliverNotificationJob,
): Promise<DeliverOutcome> {
  const deps = createDeliverDeps(db, summarizer, { orgId: job.orgId, projectId: job.projectId });
  const subjectKey = subjectKeyOf(job.event, job.subject);
  try {
    const { outcome, perChannel } = await deliverNotification(deps, job);
    console.log(
      `[notifications.deliver] event=${job.event} subject=${subjectKey} outcome=${outcome}${describe(perChannel)}`,
    );
    return outcome;
  } catch (error) {
    console.error(
      `[notifications.deliver] event=${job.event} subject=${subjectKey} retry: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

function describe(perChannel: Partial<Record<NotificationChannelId, string>>): string {
  return Object.entries(perChannel)
    .map(([c, s]) => ` ${c}=${s}`)
    .join("");
}
