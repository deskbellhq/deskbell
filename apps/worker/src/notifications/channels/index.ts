import { createSlackChannel, type SlackTarget } from "./slack";
import type { NotificationChannel } from "./types";
import { createWebhookChannel, type WebhookTarget } from "./webhook";

/** Every channel the worker can deliver through, by id. */
export interface Channels {
  slack: NotificationChannel<SlackTarget>;
  webhook: NotificationChannel<WebhookTarget>;
}

export function createChannels(fetchImpl: typeof fetch = fetch): Channels {
  return { slack: createSlackChannel(fetchImpl), webhook: createWebhookChannel(fetchImpl) };
}

export type { DeliveryResult, NotificationChannel } from "./types";
export { RetryableDeliveryError } from "./types";
