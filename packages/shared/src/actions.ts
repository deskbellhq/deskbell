import { z } from "zod";
import { ACTION_CITATION_KIND } from "./source-types";

/**
 * Actions through MCP (spec: mcp-actions). A project attaches remote MCP
 * servers; their tools are discovered and switched per tool between off,
 * allowed and needs-confirmation. This module holds the stored shapes, the
 * validation the settings page runs, and the vocabulary the wire events and
 * the audit rows share. The widget reads none of it by value.
 */

export { ACTION_CITATION_KIND };

export const ACTION_POLICIES = ["off", "allow", "confirm"] as const;
export type ActionPolicy = (typeof ACTION_POLICIES)[number];

export const ACTION_TRANSPORTS = ["http", "sse"] as const;
export type ActionTransport = (typeof ACTION_TRANSPORTS)[number];

export const ACTION_AUTH_KINDS = ["none", "bearer", "header"] as const;
export type ActionAuthKind = (typeof ACTION_AUTH_KINDS)[number];

/**
 * How a server learns who the visitor is: not at all, a token this instance
 * signs (`X-Deskbell-Identity`), or the visitor's own provider token as the
 * bearer — exchanged for one addressed to the server when an exchange client
 * is configured (spec: visitor-token-actions).
 */
export const ACTION_IDENTITY_MODES = ["none", "signed", "visitor"] as const;
export type ActionIdentityMode = (typeof ACTION_IDENTITY_MODES)[number];

/** The modes under which an anonymous visitor is offered none of the server's tools. */
export function identityRequired(mode: ActionIdentityMode): boolean {
  return mode !== "none";
}

/** Every state an attempted call passes through; also the audit row's status. */
export const ACTION_CALL_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "pending_approval",
  "approved",
  "denied",
  "expired",
] as const;
export type ActionCallStatus = (typeof ACTION_CALL_STATUSES)[number];

export const ACTION_LIMITS = {
  servers: 10,
  tools: 100,
  name: 60,
  slug: 40,
  url: 2048,
  headerName: 64,
  secret: 4096,
  /** An OAuth client id, audience or scope list for a token exchange. */
  exchangeField: 500,
  /** The description the model is shown; longer ones are cut, never hidden. */
  description: 1000,
  /** The confirmation card's one-line summary of a call. */
  summary: 200,
  /** What a tool is called in the widget, when the operator names it. */
  label: 60,
  /** Rows on a confirmation card, and the length of each value. */
  detailRows: 12,
  detailValue: 200,
} as const;

/** The header a signed visitor identity travels in (spec: mcp-actions, Identity). */
export const ACTION_IDENTITY_HEADER = "x-deskbell-identity";

export const ACTION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The stored shape of one attached server, without the discovered tools. */
export const ActionServerSchema = z.object({
  name: z.string().trim().min(1).max(ACTION_LIMITS.name),
  /** Namespaces the server's tools (`<slug>__<tool>`) and is the token audience. */
  slug: z.string().regex(ACTION_SLUG_PATTERN, "lowercase letters, digits and dashes"),
  url: z.string().url().max(ACTION_LIMITS.url),
  transport: z.enum(ACTION_TRANSPORTS).default("http"),
  authKind: z.enum(ACTION_AUTH_KINDS).default("none"),
  /** Header carrying the secret when `authKind` is "header". */
  authHeaderName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "a header name")
    .optional(),
  identity: z.enum(ACTION_IDENTITY_MODES).default("none"),
  /**
   * With `identity: visitor`, the OAuth client Deskbell exchanges the
   * visitor's token with (RFC 8693). Absent means the token is forwarded as
   * it was received. The secret rides beside `authSecret`, outside this shape.
   */
  exchangeClientId: z.string().trim().min(1).max(ACTION_LIMITS.exchangeField).optional(),
  exchangeAudience: z.string().trim().min(1).max(ACTION_LIMITS.exchangeField).optional(),
  exchangeScope: z.string().trim().min(1).max(ACTION_LIMITS.exchangeField).optional(),
  enabled: z.boolean().default(true),
});
export type ActionServerInput = z.input<typeof ActionServerSchema>;
export type ActionServerConfig = z.infer<typeof ActionServerSchema>;

export const ActionPoliciesSchema = z.record(z.string().min(1).max(200), z.enum(ACTION_POLICIES));
export type ActionPolicies = z.infer<typeof ActionPoliciesSchema>;

/** What each tool is called in the widget, by tool name; absent = the derived title. */
export const ActionLabelsSchema = z.record(
  z.string().min(1).max(200),
  z.string().trim().min(1).max(ACTION_LIMITS.label),
);
export type ActionLabels = z.infer<typeof ActionLabelsSchema>;

/** The hints MCP lets a server attach to a tool. All advisory. */
export const ActionToolAnnotationsSchema = z.object({
  title: z.string().max(200).optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});
export type ActionToolAnnotations = z.infer<typeof ActionToolAnnotationsSchema>;

/** One discovered tool, as stored on the server row after a refresh. */
export const ActionToolDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  description: z.string().max(10_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: ActionToolAnnotationsSchema.optional(),
});
export type ActionToolDefinition = z.infer<typeof ActionToolDefinitionSchema>;

/** What the server said about itself at initialization. */
export interface ActionServerInfo {
  name: string;
  version: string;
  title?: string;
  protocolVersion?: string;
}

/**
 * The policy suggested for a tool nobody has decided about yet. Read-only by
 * the server's own declaration is the only thing that earns "allow"; anything
 * else asks the visitor first. Never "off": the suggestion is shown, the
 * stored default is off until an operator chooses.
 */
export function suggestedPolicy(tool: Pick<ActionToolDefinition, "annotations">): ActionPolicy {
  return tool.annotations?.readOnlyHint === true ? "allow" : "confirm";
}

/** The stored policy for a tool, or off when none was chosen. */
export function policyFor(policies: ActionPolicies | null | undefined, tool: string): ActionPolicy {
  return policies?.[tool] ?? "off";
}

/** The name the model sees: server slug and tool, joined so two servers may both have `search`. */
export function actionToolName(slug: string, tool: string): string {
  return `${slug}__${tool}`;
}

export function splitActionToolName(name: string): { slug: string; tool: string } | null {
  const at = name.indexOf("__");
  if (at <= 0 || at === name.length - 2) return null;
  return { slug: name.slice(0, at), tool: name.slice(at + 2) };
}

/** The title shown for a tool: its title, else its annotation title, else the name with separators as spaces. */
export function actionToolTitle(
  tool: Pick<ActionToolDefinition, "name" | "title" | "annotations">,
): string {
  const given = tool.title?.trim() || tool.annotations?.title?.trim();
  if (given) return given.slice(0, 200);
  const words = tool.name.replace(/[_-]+/g, " ").trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 200);
}

/**
 * What the visitor sees a tool called (spec: action-presentation): the
 * operator's label when one is set, else the derived title. Every event,
 * audit row and citation names the tool this way.
 */
export function actionVisitorLabel(
  tool: Pick<ActionToolDefinition, "name" | "title" | "annotations">,
  labels: ActionLabels | null | undefined,
): string {
  const label = labels?.[tool.name]?.trim();
  return label ? label.slice(0, ACTION_LIMITS.label) : actionToolTitle(tool);
}

/** The description the model is shown: trimmed and cut to the limit. */
export function actionToolDescription(tool: Pick<ActionToolDefinition, "description">): string {
  const text = tool.description?.trim() ?? "";
  return text.length <= ACTION_LIMITS.description
    ? text
    : `${text.slice(0, ACTION_LIMITS.description - 1)}…`;
}

/**
 * One line naming the call for the confirmation card: the tool's title and
 * its scalar arguments. Rendered server-side so the widget stays dumb, and
 * so what the visitor confirms is what the audit row stores.
 */
export function actionSummary(title: string, input: unknown): string {
  const parts: string[] = [];
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object") continue;
      parts.push(`${key}: ${String(value)}`);
    }
  }
  const line = parts.length > 0 ? `${title} — ${parts.join(", ")}` : title;
  return line.length <= ACTION_LIMITS.summary
    ? line
    : `${line.slice(0, ACTION_LIMITS.summary - 1)}…`;
}

/** One row of a confirmation card: an argument, named for the visitor. */
export interface ActionDetail {
  label: string;
  value: string;
}

const UPPER_WORDS = new Set(["id", "url", "ip", "sku", "api"]);

/** `repoName` → "Repo name", `order_id` → "Order ID". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.\s]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => (UPPER_WORDS.has(w) ? w.toUpperCase() : w));
  const first = words[0];
  if (!first) return key;
  words[0] = UPPER_WORDS.has(first.toLowerCase())
    ? first
    : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

function detailValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    return value
      .filter((v) => v !== null && v !== undefined)
      .map(String)
      .join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * A call's arguments as rows for the confirmation card (spec:
 * action-presentation). Labels come from the tool's input schema
 * (`properties.<key>.title`), else from the key itself; values are text.
 * Rendered server-side and stored with the call, so what the visitor
 * confirms is what the audit row shows.
 */
export function actionDetails(input: unknown, inputSchema?: unknown): ActionDetail[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const props =
    inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
      ? (inputSchema as { properties?: unknown }).properties
      : undefined;
  const rows: ActionDetail[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const value = detailValue(raw);
    if (value === null || value === "") continue;
    const prop =
      props && typeof props === "object" ? (props as Record<string, unknown>)[key] : undefined;
    const title =
      prop && typeof prop === "object" ? (prop as { title?: unknown }).title : undefined;
    const label = typeof title === "string" && title.trim() ? title.trim() : humanizeKey(key);
    rows.push({
      label: label.slice(0, ACTION_LIMITS.label),
      value:
        value.length <= ACTION_LIMITS.detailValue
          ? value
          : `${value.slice(0, ACTION_LIMITS.detailValue - 1)}…`,
    });
    if (rows.length >= ACTION_LIMITS.detailRows) break;
  }
  return rows;
}

/** An action as replayed with a message, so a card or a step line survives a reload. */
export interface WidgetAction {
  id: string;
  title: string;
  status: ActionCallStatus;
  /** Present for a confirmation request. */
  summary?: string;
  /** The call's arguments as the card shows them. */
  details?: ActionDetail[];
  /** ISO timestamp after which a pending request can no longer be answered. */
  expiresAt?: string;
}
