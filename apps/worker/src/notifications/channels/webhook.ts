import {
  NOTIFICATION_DELIVERY_HEADER,
  NOTIFICATION_EVENT_HEADER,
  NOTIFICATION_SIGNATURE_HEADER,
  NOTIFICATION_TIMESTAMP_HEADER,
  type NotificationEvent,
  signNotification,
} from "@deskbell/shared";
import { postJson } from "./http";
import type { NotificationChannel } from "./types";

/**
 * Generic JSON webhook (spec: project-notifications): the event as it is,
 * signed with the channel's secret. The headers are the contract a receiver
 * verifies against; `verifyNotificationSignature` in the shared package is
 * the reference implementation.
 */

export interface WebhookTarget {
  url: string;
  signingSecret: string;
}

export async function webhookHeaders(
  event: NotificationEvent,
  body: string,
  secret: string,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  return {
    [NOTIFICATION_EVENT_HEADER]: event.type,
    [NOTIFICATION_DELIVERY_HEADER]: event.id,
    [NOTIFICATION_TIMESTAMP_HEADER]: String(now),
    [NOTIFICATION_SIGNATURE_HEADER]: await signNotification(secret, now, body),
  };
}

export function createWebhookChannel(
  fetchImpl: typeof fetch = fetch,
): NotificationChannel<WebhookTarget> {
  return {
    id: "webhook",
    render: (event) => event,
    async deliver(target, payload, event) {
      const body = JSON.stringify(payload);
      const headers = await webhookHeaders(event, body, target.signingSecret);
      return postJson(target.url, body, headers, fetchImpl);
    },
  };
}
