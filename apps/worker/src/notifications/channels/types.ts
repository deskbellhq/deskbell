import type { NotificationChannelId, NotificationEvent } from "@deskbell/shared";

/**
 * A channel (spec: project-notifications) turns an event into its own
 * payload and delivers it to a target. `deliver` answers "delivered" or
 * "rejected" for outcomes a retry cannot change, and throws for the ones it
 * can — a 5xx, a 429, a network error, a timeout — so pg-boss retries.
 */
export interface NotificationChannel<Target> {
  id: NotificationChannelId;
  /** The target is passed because a channel may carry per-event message templates. */
  render(event: NotificationEvent, target: Target): unknown;
  deliver(target: Target, payload: unknown, event: NotificationEvent): Promise<DeliveryResult>;
}

export type DeliveryResult = { status: "delivered" } | { status: "rejected"; error: string };

/** Thrown for failures a retry may fix. */
export class RetryableDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableDeliveryError";
  }
}
