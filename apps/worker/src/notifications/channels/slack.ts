import {
  NOTIFICATION_EVENT_META,
  type NotificationEvent,
  type NotificationEventToggles,
  type NotificationEventType,
  renderTemplate,
  templateValues,
} from "@deskbell/shared";
import { postJson } from "./http";
import type { NotificationChannel } from "./types";

/**
 * Slack incoming webhook (spec: project-notifications): Block Kit per event
 * type, with a top-level `text` so a push notification reads. Visitor and
 * model text is escaped before it goes into mrkdwn; without it a comment
 * containing Slack's link markup renders as a link in the channel.
 */

export interface SlackTarget {
  webhookUrl: string;
  events?: NotificationEventToggles;
  /** Per-event mrkdwn text; absent means the built-in Block Kit layout. */
  templates?: Partial<Record<NotificationEventType, string>>;
}

const SECTION_CHARS = 3000;

/**
 * A custom template renders as one mrkdwn section plus the Open conversation
 * button, which stays so the link is never lost to an edit. The template's
 * own markup is the operator's; every substituted value is escaped.
 */
export function slackMessageFromTemplate(
  event: NotificationEvent,
  template: string,
): { text: string; blocks: Block[] } {
  const rendered = clip(
    renderTemplate(template, templateValues(event), slackEscape),
    SECTION_CHARS,
    true,
  );
  return {
    text: clip(rendered.replace(/[*_~`>]/g, ""), 300),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: rendered } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open conversation" },
            url: event.url,
          },
        ],
      },
    ],
  };
}

const QUESTION_CHARS = 500;
const FIELD_CHARS = 300;
const MAX_FIELDS = 10;

export function slackEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function clip(text: string, max: number, keepLines = false): string {
  const one = (keepLines ? text.replace(/[ \t]+/g, " ") : text.replace(/\s+/g, " ")).trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

type Block = Record<string, unknown>;

export function slackMessage(event: NotificationEvent): { text: string; blocks: Block[] } {
  switch (event.type) {
    case "feedback.negative": {
      const { data } = event;
      const question = slackEscape(clip(data.message.question, QUESTION_CHARS));
      const fields: Array<{ type: "mrkdwn"; text: string }> = [
        {
          type: "mrkdwn",
          text: `*Reason*\n${slackEscape(data.feedback.reasonLabel ?? data.feedback.reason ?? "—")}`,
        },
        {
          type: "mrkdwn",
          text: `*Comment*\n${data.feedback.comment ? slackEscape(clip(data.feedback.comment, FIELD_CHARS)) : "—"}`,
        },
      ];
      const contextFields = Object.entries(data.conversation.context ?? {})
        .slice(0, MAX_FIELDS)
        .map(([key, value]) => ({
          type: "mrkdwn" as const,
          text: `*${slackEscape(key)}*\n${value.name ? `${slackEscape(clip(value.name, FIELD_CHARS))} (\`${slackEscape(value.id)}\`)` : `\`${slackEscape(value.id)}\``}`,
        }));
      const blocks: Block[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: clip(`${NOTIFICATION_EVENT_META[event.type].label} · ${event.project.name}`, 150),
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `> ${question.replaceAll("\n", "\n> ")}` },
        },
        { type: "section", fields },
      ];
      if (contextFields.length > 0) blocks.push({ type: "section", fields: contextFields });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Summary*\n${slackEscape(clip(data.summary.text, FIELD_CHARS))}`,
        },
      });
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open conversation" },
            url: event.url,
          },
        ],
      });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `message \`${slackEscape(data.message.id)}\` · ${event.createdAt}`,
          },
        ],
      });
      return {
        text: clip(
          `${NOTIFICATION_EVENT_META[event.type].label} on ${event.project.name}: ${data.message.question}`,
          300,
        ),
        blocks,
      };
    }
    default:
      return unreachable(event.type);
  }
}

function unreachable(type: never): never {
  throw new Error(`no Slack rendering for event ${String(type)}`);
}

export function createSlackChannel(
  fetchImpl: typeof fetch = fetch,
): NotificationChannel<SlackTarget> {
  return {
    id: "slack",
    render(event, target) {
      const template = target.templates?.[event.type]?.trim();
      return template ? slackMessageFromTemplate(event, template) : slackMessage(event);
    },
    deliver(target, payload) {
      return postJson(target.webhookUrl, JSON.stringify(payload), {}, fetchImpl);
    },
  };
}
