import { z } from "zod";
import { ConversationContextSchema } from "./conversation-context.ts";

/**
 * Project notifications (spec: project-notifications): the events a project
 * can be told about and the channels it can be told through. The event is a
 * stable envelope with a per-type body; the settings are channel-first, each
 * channel choosing which events it receives. Everything here is data on the
 * wire or in a jsonb column and is validated on both ends.
 */

export const NOTIFICATION_EVENT_TYPES = ["feedback.negative"] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** What the settings page and the docs say about each event. */
export const NOTIFICATION_EVENT_META: Record<
  NotificationEventType,
  { label: string; description: string }
> = {
  "feedback.negative": {
    label: "Negative feedback",
    description: "A visitor marked an answer down, with the reason and comment they gave.",
  },
};

export const NOTIFICATION_CHANNEL_IDS = ["slack", "webhook"] as const;
export type NotificationChannelId = (typeof NOTIFICATION_CHANNEL_IDS)[number];

/** The built-in downvote reasons, as a notification names them. */
export const DEFAULT_FEEDBACK_REASON_LABELS: Record<string, string> = {
  incorrect: "Inaccurate",
  irrelevant: "Not relevant",
  unaddressed: "Didn't answer the question",
};

// ---------------------------------------------------------------------------
// Events

const EnvelopeSchema = z.object({
  /** The delivery id; a receiver's idempotency key. */
  id: z.string().min(1),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  project: z.object({ id: z.string().min(1), name: z.string() }),
  /** Where a person should go to act on it. */
  url: z.string().url(),
});

export const FeedbackNegativeDataSchema = z.object({
  conversation: z.object({
    id: z.string().min(1),
    title: z.string().nullable(),
    context: ConversationContextSchema.nullable(),
  }),
  message: z.object({
    id: z.string().min(1),
    createdAt: z.string().datetime(),
    question: z.string(),
    answer: z.string(),
  }),
  feedback: z.object({
    reason: z.string().nullable(),
    reasonLabel: z.string().nullable(),
    comment: z.string().nullable(),
  }),
  summary: z.object({
    text: z.string(),
    source: z.enum(["model", "title", "question"]),
  }),
});
export type FeedbackNegativeData = z.infer<typeof FeedbackNegativeDataSchema>;

export const NotificationEventSchema = z.discriminatedUnion("type", [
  EnvelopeSchema.extend({ type: z.literal("feedback.negative"), data: FeedbackNegativeDataSchema }),
]);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

/**
 * The delivery id for a subject: the same on every attempt, so a receiver
 * that stores `x-deskbell-delivery` sees a retry as the same delivery. A
 * hash rather than the subject itself, so the header says nothing about
 * what the subject is.
 */
export async function notificationDeliveryId(input: {
  projectId: string;
  event: NotificationEventType;
  subjectKey: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(`${input.projectId}:${input.event}:${input.subjectKey}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `ntf_${hex.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Settings

const EventTogglesSchema = z.partialRecord(z.enum(NOTIFICATION_EVENT_TYPES), z.boolean());
export type NotificationEventToggles = z.infer<typeof EventTogglesSchema>;

export const NOTIFICATION_LINK_TEMPLATE_MAX_CHARS = 500;
/** Slack caps a section at 3000 characters; the template is capped below that so substitution fits. */
export const NOTIFICATION_TEMPLATE_MAX_CHARS = 2500;

export const ProjectNotificationsSchema = z.object({
  channels: z
    .object({
      slack: z
        .object({
          webhookUrl: z.string().url().max(2048),
          events: EventTogglesSchema.optional(),
          /** Per-event message text; absent means the built-in layout. See renderTemplate. */
          templates: z
            .partialRecord(
              z.enum(NOTIFICATION_EVENT_TYPES),
              z.string().max(NOTIFICATION_TEMPLATE_MAX_CHARS),
            )
            .optional(),
        })
        .optional(),
      webhook: z
        .object({
          url: z.string().url().max(2048),
          signingSecret: z.string().min(16).max(200),
          events: EventTogglesSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  /** A host's own conversation page; see conversationUrl for the placeholders. */
  conversationLinkTemplate: z.string().max(NOTIFICATION_LINK_TEMPLATE_MAX_CHARS).optional(),
});
export type ProjectNotifications = z.infer<typeof ProjectNotificationsSchema>;

/** The channels that have a target and this event switched on. */
export function channelsFor(
  settings: Partial<ProjectNotifications> | null | undefined,
  type: NotificationEventType,
): NotificationChannelId[] {
  const out: NotificationChannelId[] = [];
  const channels = settings?.channels;
  if (channels?.slack?.webhookUrl && channels.slack.events?.[type] !== false) out.push("slack");
  if (channels?.webhook?.url && channels.webhook.events?.[type] !== false) out.push("webhook");
  return out;
}

// ---------------------------------------------------------------------------
// Conversation link

export const NOTIFICATION_LINK_PLACEHOLDER =
  /\{(conversationId|context\.([a-z][a-z0-9_-]*)\.(id|name))\}/gi;

/**
 * The link a notification carries. Without a template it is the dashboard's
 * conversation page. With one, `{conversationId}`, `{context.<key>.id}` and
 * `{context.<key>.name}` are substituted URL-encoded; a placeholder the
 * conversation cannot fill falls back to the dashboard link, because a
 * broken link is worse than a plain one.
 */
export function conversationUrl(input: {
  baseUrl: string;
  conversationId: string;
  context?: Record<string, { id: string; name?: string }> | null;
  template?: string | null;
}): string {
  const fallback = `${input.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(input.conversationId)}`;
  const template = input.template?.trim();
  if (!template) return fallback;
  let missing = false;
  const filled = template.replace(
    NOTIFICATION_LINK_PLACEHOLDER,
    (_m, name: string, key?: string, field?: string) => {
      if (name === "conversationId") return encodeURIComponent(input.conversationId);
      const entry = key ? input.context?.[key] : undefined;
      const value = field === "name" ? entry?.name : entry?.id;
      if (value === undefined) {
        missing = true;
        return "";
      }
      return encodeURIComponent(value);
    },
  );
  return missing ? fallback : filled;
}

/**
 * Checks a template at save time: only known placeholders, and a valid
 * https URL once every placeholder holds a value.
 */
export function validateLinkTemplate(
  raw: string,
): { ok: true; template: string } | { ok: false; reason: string } {
  const template = raw.trim();
  if (!template) return { ok: false, reason: "Enter a template." };
  if (template.length > NOTIFICATION_LINK_TEMPLATE_MAX_CHARS) {
    return {
      ok: false,
      reason: `The template must be at most ${NOTIFICATION_LINK_TEMPLATE_MAX_CHARS} characters.`,
    };
  }
  const unknown = template.replace(NOTIFICATION_LINK_PLACEHOLDER, "").match(/\{[^}]*\}/);
  if (unknown) {
    return {
      ok: false,
      reason: `Unknown placeholder ${unknown[0]}. Use {conversationId}, {context.<key>.id} or {context.<key>.name}.`,
    };
  }
  const probe = template.replace(NOTIFICATION_LINK_PLACEHOLDER, "x");
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return {
      ok: false,
      reason: "The template must be a full URL once its placeholders are filled.",
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The template must be an http(s) URL." };
  }
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Message templates

/**
 * The placeholders a message template may use, per event: every scalar of
 * the event, flattened, plus `context.<key>.id` and `context.<key>.name`
 * for whatever keys the conversation carries and `context` for all of them
 * on one line each. Shared by the settings validation, the docs and the
 * renderer, so the three cannot disagree.
 */
export const NOTIFICATION_PLACEHOLDERS: Record<NotificationEventType, readonly string[]> = {
  "feedback.negative": [
    "event.label",
    "project.name",
    "url",
    "createdAt",
    "conversation.id",
    "conversation.title",
    "message.id",
    "question",
    "answer",
    "reason",
    "comment",
    "summary",
    "context",
  ],
};

const PLACEHOLDER = /\{([a-z][a-z0-9_.-]*)\}/gi;
const CONTEXT_PLACEHOLDER = /^context\.[a-z][a-z0-9_-]*\.(id|name)$/i;

/** The values behind the placeholders of one event; every key is a string. */
export function templateValues(event: NotificationEvent): Record<string, string> {
  const values: Record<string, string> = {
    "event.label": NOTIFICATION_EVENT_META[event.type].label,
    "project.name": event.project.name,
    url: event.url,
    createdAt: event.createdAt,
  };
  switch (event.type) {
    case "feedback.negative": {
      const { data } = event;
      values["conversation.id"] = data.conversation.id;
      values["conversation.title"] = data.conversation.title ?? "";
      values["message.id"] = data.message.id;
      values.question = data.message.question;
      values.answer = data.message.answer;
      values.reason = data.feedback.reasonLabel ?? data.feedback.reason ?? "";
      values.comment = data.feedback.comment ?? "";
      values.summary = data.summary.text;
      const context = data.conversation.context ?? {};
      values.context = Object.entries(context)
        .map(([key, v]) => `${key}: ${v.name ? `${v.name} (${v.id})` : v.id}`)
        .join("\n");
      for (const [key, v] of Object.entries(context)) {
        values[`context.${key}.id`] = v.id;
        values[`context.${key}.name`] = v.name ?? "";
      }
      break;
    }
  }
  return values;
}

/**
 * Substitute placeholders; each value goes through `escape` so visitor text
 * cannot inject the channel's markup. A placeholder the event has no value
 * for (a context key this conversation lacks) becomes empty.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
  escapeValue: (text: string) => string = (t) => t,
): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const value = values[name];
    return value === undefined ? "" : escapeValue(value);
  });
}

/** Save-time check: only known placeholders, within the length cap. */
export function validateMessageTemplate(
  type: NotificationEventType,
  raw: string,
): { ok: true; template: string } | { ok: false; reason: string } {
  const template = raw.trim();
  if (!template) return { ok: false, reason: "Enter a template." };
  if (template.length > NOTIFICATION_TEMPLATE_MAX_CHARS) {
    return {
      ok: false,
      reason: `The template must be at most ${NOTIFICATION_TEMPLATE_MAX_CHARS} characters.`,
    };
  }
  const known = new Set(NOTIFICATION_PLACEHOLDERS[type]);
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    if (!known.has(name) && !CONTEXT_PLACEHOLDER.test(name)) {
      return { ok: false, reason: `Unknown placeholder {${name}}.` };
    }
  }
  return { ok: true, template };
}

/** A starting point for a custom Slack message, in mrkdwn. */
export const DEFAULT_SLACK_TEMPLATES: Record<NotificationEventType, string> = {
  "feedback.negative": [
    "*{event.label} · {project.name}*",
    "> {question}",
    "*Reason:* {reason}   *Comment:* {comment}",
    "{context}",
    "*Summary:* {summary}",
    "<{url}|Open conversation>",
  ].join("\n"),
};
