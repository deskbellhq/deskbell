import {
  maskSecret,
  maskWebhookUrl,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannelId,
  type NotificationEventToggles,
  type NotificationEventType,
  type ProjectNotifications,
  ProjectNotificationsSchema,
  validateLinkTemplate,
  validateMessageTemplate,
  validateWebhookUrl,
} from "@deskbell/shared";

/**
 * The settings page's two pure halves (spec: project-notifications): what
 * the client is allowed to see of the stored document, and how a submitted
 * form merges into it. Secrets never leave the server: the view carries a
 * mask, and an empty URL field on save means "keep what is stored".
 */

export interface ChannelView {
  configured: boolean;
  /** The origin and an ellipsis; null when unconfigured. */
  masked: string | null;
  events: Record<NotificationEventType, boolean>;
  lastDelivery: DeliveryView | null;
}

export interface DeliveryView {
  status: "delivered" | "rejected";
  at: string;
  error: string | null;
}

export interface NotificationsView {
  slack: ChannelView & { templates: Partial<Record<NotificationEventType, string>> };
  webhook: ChannelView & { secretMasked: string | null };
  conversationLinkTemplate: string;
}

function toggles(
  events: NotificationEventToggles | undefined,
): Record<NotificationEventType, boolean> {
  return Object.fromEntries(
    NOTIFICATION_EVENT_TYPES.map((t) => [t, events?.[t] !== false]),
  ) as Record<NotificationEventType, boolean>;
}

export function notificationsView(
  stored: Partial<ProjectNotifications> | null | undefined,
  lastDelivery: Partial<Record<NotificationChannelId, DeliveryView>> = {},
): NotificationsView {
  const slack = stored?.channels?.slack;
  const webhook = stored?.channels?.webhook;
  return {
    slack: {
      configured: Boolean(slack?.webhookUrl),
      masked: slack?.webhookUrl ? maskWebhookUrl(slack.webhookUrl) : null,
      events: toggles(slack?.events),
      lastDelivery: lastDelivery.slack ?? null,
      templates: slack?.templates ?? {},
    },
    webhook: {
      configured: Boolean(webhook?.url),
      masked: webhook?.url ? maskWebhookUrl(webhook.url) : null,
      secretMasked: webhook?.signingSecret ? maskSecret(webhook.signingSecret) : null,
      events: toggles(webhook?.events),
      lastDelivery: lastDelivery.webhook ?? null,
    },
    conversationLinkTemplate: stored?.conversationLinkTemplate ?? "",
  };
}

export interface NotificationsFormInput {
  slackUrl: string;
  slackRemove: boolean;
  slackEvents: NotificationEventToggles;
  /** Per-event message text; empty means the built-in layout. */
  slackTemplates: Partial<Record<NotificationEventType, string>>;
  webhookUrl: string;
  webhookRemove: boolean;
  webhookEvents: NotificationEventToggles;
  conversationLinkTemplate: string;
}

export type MergeResult =
  | { ok: true; settings: ProjectNotifications; revealedSecret: string | null }
  | { ok: false; error: string };

/**
 * Merge a form into the stored document. A URL field left empty keeps the
 * stored target; a new value replaces it after validation; Remove clears
 * it. A webhook target set for the first time mints a signing secret, which
 * is returned once for the page to show.
 */
export function mergeNotificationSettings(
  stored: Partial<ProjectNotifications> | null | undefined,
  form: NotificationsFormInput,
  newSecret: () => string,
): MergeResult {
  const next: ProjectNotifications = { channels: {} };
  let revealedSecret: string | null = null;

  const slackUrl = form.slackRemove
    ? null
    : form.slackUrl.trim() || stored?.channels?.slack?.webhookUrl || null;
  if (slackUrl) {
    const check = validateWebhookUrl(slackUrl);
    if (!check.ok) return { ok: false, error: `Slack: ${check.reason}` };
    const templates: Partial<Record<NotificationEventType, string>> = {};
    for (const type of NOTIFICATION_EVENT_TYPES) {
      const raw = form.slackTemplates[type]?.trim();
      if (!raw) continue;
      const t = validateMessageTemplate(type, raw);
      if (!t.ok) return { ok: false, error: `Slack message: ${t.reason}` };
      templates[type] = t.template;
    }
    next.channels = {
      ...next.channels,
      slack: {
        webhookUrl: check.url,
        events: form.slackEvents,
        ...(Object.keys(templates).length > 0 ? { templates } : {}),
      },
    };
  }

  const webhookUrl = form.webhookRemove
    ? null
    : form.webhookUrl.trim() || stored?.channels?.webhook?.url || null;
  if (webhookUrl) {
    const check = validateWebhookUrl(webhookUrl);
    if (!check.ok) return { ok: false, error: `Webhook: ${check.reason}` };
    let signingSecret = stored?.channels?.webhook?.signingSecret;
    if (!signingSecret) {
      signingSecret = newSecret();
      revealedSecret = signingSecret;
    }
    next.channels = {
      ...next.channels,
      webhook: { url: check.url, signingSecret, events: form.webhookEvents },
    };
  }

  const template = form.conversationLinkTemplate.trim();
  if (template) {
    const check = validateLinkTemplate(template);
    if (!check.ok) return { ok: false, error: `Link template: ${check.reason}` };
    next.conversationLinkTemplate = check.template;
  }

  if (Object.keys(next.channels ?? {}).length === 0) next.channels = undefined;
  const parsed = ProjectNotificationsSchema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join(".") || "notifications"}: ${issue.message}`
        : "Invalid settings",
    };
  }
  return { ok: true, settings: parsed.data, revealedSecret };
}
