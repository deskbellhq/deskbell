import { z } from "zod";
import type { ActionCallStatus, ActionDetail, WidgetAction } from "./actions";
import { type ConversationContext, ConversationContextSchema } from "./conversation-context";
import {
  COPY_KEYS,
  FEEDBACK_REASON_LIMITS,
  PROMPT_GROUP_LIMITS,
  REASON_ID_PATTERN,
  TOKENS,
  WIDGET_OPTIONS,
  type WidgetAppearance,
  type WidgetOption,
} from "./widget-config";

export * from "./actions";
export * from "./conversation-context";
export * from "./jobs";
export * from "./notification-signature";
export * from "./notifications";
export * from "./webhook-url";
export * from "./widget-config";

/**
 * Wire contracts shared by the widget, SDK, server, and engine.
 * MIT-licensed: these types ship inside customers' bundles.
 */

/**
 * Per-project end-user identity (spec: end-user-identity). When `issuer` is
 * set the server verifies `Authorization: Bearer` tokens from that OpenID
 * issuer; a verified user owns their conversations across devices. Keys come
 * from `jwksUrl` or an inline `jwks` document (air-gapped installs, tests).
 * `required` refuses anonymous callers outright. `staffClaim` names a claim
 * (dot path) and value that marks support staff.
 */
export const ProjectIdentitySchema = z.object({
  issuer: z.string().url().max(500),
  audience: z.string().min(1).max(200).optional(),
  jwksUrl: z.string().url().max(500).optional(),
  jwks: z.object({ keys: z.array(z.record(z.string(), z.unknown())) }).optional(),
  required: z.boolean().default(false),
  staffClaim: z
    .object({ path: z.string().min(1).max(200), value: z.string().min(1).max(200) })
    .optional(),
});
export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>;

/**
 * Per-project gap-clustering settings (spec: gap-cluster-members-and-ignored-terms).
 * `ignoredTerms` are removed from a question before it is embedded to find its
 * cluster, and nowhere else: the label, the export and the analysis keep the
 * question as it was typed. A product or organisation name repeated in every
 * question is measurable noise — it pulls unrelated questions together.
 *
 * Absent and empty mean different things. Absent is the default and resolves to
 * the organisation's name; empty is an operator saying "strip nothing", which
 * has to survive an organisation rename.
 */
export const IGNORED_TERM_LIMIT = 20;
export const IGNORED_TERM_MAX_LENGTH = 100;
export const IgnoredTermsSchema = z
  .array(z.string().trim().min(1).max(IGNORED_TERM_MAX_LENGTH))
  .max(IGNORED_TERM_LIMIT)
  // Case-insensitive de-duplication, first spelling wins: matching ignores case
  // anyway, so two spellings of one term are one term.
  .transform((terms) => {
    const kept = new Map<string, string>();
    for (const term of terms) if (!kept.has(term.toLowerCase())) kept.set(term.toLowerCase(), term);
    return [...kept.values()];
  });
export const ProjectGapsSchema = z.object({ ignoredTerms: IgnoredTermsSchema.optional() });
export type ProjectGaps = z.infer<typeof ProjectGapsSchema>;

/**
 * Conversation retention (spec: conversation-retention): how many days a
 * conversation with no new message is kept before the worker removes it.
 * 0 keeps everything, like a daily token budget of 0 means unlimited. Coerced
 * so a form field's string parses; a blank field is 0.
 */
export const CONVERSATION_RETENTION_MAX_DAYS = 3650;
export const CONVERSATION_RETENTION_PRESETS = [0, 30, 90, 180, 365] as const;
export const ConversationRetentionDaysSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? 0 : value),
  z.coerce.number().int().min(0).max(CONVERSATION_RETENTION_MAX_DAYS),
);

/**
 * Parse a textarea into ignored terms: one per line or comma-separated. A term
 * may contain spaces (an organisation's name usually does), so only newlines
 * and commas separate.
 */
export function parseIgnoredTerms(
  raw: string,
): { ok: true; terms: string[] } | { ok: false; reason: string } {
  const parts = raw
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const parsed = IgnoredTermsSchema.safeParse(parts);
  if (parsed.success) return { ok: true, terms: parsed.data };
  const issue = parsed.error.issues[0];
  const which = issue && typeof issue.path[0] === "number" ? parts[issue.path[0]] : undefined;
  return {
    ok: false,
    reason: which
      ? `"${which}" is too long — keep a term under ${IGNORED_TERM_MAX_LENGTH} characters.`
      : (issue?.message ?? `Keep the list to ${IGNORED_TERM_LIMIT} terms.`),
  };
}

export const AskRequestSchema = z
  .object({
    /** Public widget key — bound server-side to allowed origins (see D12: abuse protection). */
    projectKey: z.string().min(1),
    /** Anonymous per-visitor session; the widget generates and persists it. */
    sessionId: z.string().min(1).max(128),
    /** Continue this thread (must belong to the caller); absent → a new conversation. */
    conversationId: z.string().min(1).optional(),
    /** The question. May be empty only when `approval` answers a pending request. */
    message: z.string().max(4000).default(""),
    /** BCP 47 tag of the visitor's UI language; retrieval is cross-language. */
    locale: z.string().max(35).optional(),
    /** Attached to a NEW conversation only; ignored when continuing one. */
    context: ConversationContextSchema.optional(),
    /**
     * The visitor's answer to a `confirm` event (spec: mcp-actions). Continues
     * the turn that paused: requires `conversationId`, and the call must still
     * be pending there. The message is ignored.
     */
    approval: z.object({ callId: z.string().min(1).max(128), approved: z.boolean() }).optional(),
  })
  .refine((r) => r.message.length > 0 || r.approval !== undefined, {
    message: "A question or an approval is required",
    path: ["message"],
  });
export type AskRequest = z.infer<typeof AskRequestSchema>;

/**
 * Email domains whose people may join the instance on their own by signing
 * in with a configured social provider (spec: sign-in-with-google). Bare
 * hostnames, lower-cased, deduplicated; an empty list means invitation only.
 */
export const SIGN_IN_DOMAIN_LIMIT = 20;
export const SignInDomainsSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        "not a domain name",
      ),
  )
  .max(SIGN_IN_DOMAIN_LIMIT)
  .transform((list) => Array.from(new Set(list)));
export type SignInDomains = z.infer<typeof SignInDomainsSchema>;

/** Parse a textarea or comma list into domains; blank lines are ignored. */
export function parseSignInDomains(
  raw: string,
): { ok: true; domains: SignInDomains } | { ok: false; reason: string } {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const parsed = SignInDomainsSchema.safeParse(parts);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const which = issue && typeof issue.path[0] === "number" ? parts[issue.path[0]] : undefined;
    return {
      ok: false,
      reason: which
        ? `"${which}" is not a domain name. Use the bare hostname, e.g. example.com.`
        : (issue?.message ?? "Invalid domain list"),
    };
  }
  return { ok: true, domains: parsed.data };
}

export const ConversationListRequestSchema = z.object({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1).max(128),
  /** Only conversations whose context carries this key with this id. */
  scope: z.object({ key: z.string().min(1).max(64), id: z.string().min(1).max(128) }).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type ConversationListRequest = z.infer<typeof ConversationListRequestSchema>;

export const ConversationDeleteRequestSchema = z.object({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1).max(128),
  conversationId: z.string().min(1),
});
export type ConversationDeleteRequest = z.infer<typeof ConversationDeleteRequestSchema>;

export const ConversationRenameRequestSchema = z.object({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1).max(128),
  conversationId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
});
export type ConversationRenameRequest = z.infer<typeof ConversationRenameRequestSchema>;

/** Read any conversation of the project, for holders of the staff claim (spec: conversation-preview). */
export const ConversationPreviewRequestSchema = z.object({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1).max(128),
  conversationId: z.string().min(1),
});
export type ConversationPreviewRequest = z.infer<typeof ConversationPreviewRequestSchema>;

export interface ConversationPreview {
  conversation: {
    id: string;
    title: string;
    context: ConversationContext | null;
    createdAt: string;
  };
  /** The signed-in visitor the conversation belongs to, when it has one. */
  endUser: { name: string | null; email: string | null } | null;
  messages: WidgetMessage[];
}

export const ConversationMessagesRequestSchema = z.object({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1).max(128),
  conversationId: z.string().min(1),
});
export type ConversationMessagesRequest = z.infer<typeof ConversationMessagesRequestSchema>;

/** One row in the widget's recent-conversations list. */
export interface WidgetConversation {
  id: string;
  /** The stored title, else the first user message. */
  title: string;
  /** Last message, truncated server-side. */
  snippet: string;
  /** ISO timestamp of the latest activity. */
  lastMessageAt: string;
  /** Context attached when the conversation was created, if any. */
  context?: ConversationContext | null;
  /** ISO timestamp of the conversation row's last update. */
  updatedAt?: string;
}

/** One persisted message, as replayed into the widget. */
export interface WidgetMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  refused: boolean;
  /** This turn asked the visitor a clarifying question; `content` holds it and the options. */
  clarified?: boolean;
  feedback: "up" | "down" | null;
  /** The downvote reason id, when one was given. */
  feedbackReason?: string | null;
  /** Tool calls the answer made or asked about (spec: mcp-actions); absent when none. */
  actions?: WidgetAction[];
  /**
   * Names the answer asserted that the documentation does not contain (spec:
   * answer-verification); absent when none. The widget speaks them as a
   * sentence under the answer, exactly as it did live.
   */
  unsupportedTerms?: string[];
  createdAt: string;
}

export const FeedbackRequestSchema = z.object({
  projectKey: z.string().min(1),
  /** Must match the conversation's session — possession is the authorization. */
  sessionId: z.string().min(1).max(128),
  /** The assistant message being rated (from the ask stream's `done` event). */
  messageId: z.string().min(1),
  /** Upsert semantics: null clears a previous vote. */
  feedback: z.enum(["up", "down"]).nullable(),
  /**
   * Downvote follow-up; ignored (cleared) unless feedback is "down". A slug the
   * project configured (spec: widget-feedback-reasons); the built-in ids are
   * `incorrect`, `irrelevant` and `unaddressed`.
   */
  reason: z.string().regex(REASON_ID_PATTERN).nullish(),
  comment: z.string().max(1000).nullish(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
export type FeedbackReason = NonNullable<FeedbackRequest["reason"]>;

/**
 * Widget install beacon (spec: single-tag-embed-deploy-onboarding): fired once
 * per tab session on mount. The server records the request's Origin header per
 * project — diagnostic install verification, never authorization.
 */
export const PingRequestSchema = z.object({
  projectKey: z.string().min(1),
});
export type PingRequest = z.infer<typeof PingRequestSchema>;

export const CitationSchema = z.object({
  documentId: z.string(),
  url: z.string().url().optional(),
  title: z.string(),
  snippet: z.string(),
  /** Source connector type (e.g. "docs-crawler"); optional so stored rows predating it still parse. */
  kind: z.string().max(40).optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/**
 * Server → client events, streamed over SSE.
 * `refusal` is a first-class outcome: a grounded "I don't know" with an
 * optional handoff hint beats a hallucinated answer (D8).
 */
export type RefusalReason = "no_context" | "no_grounding" | "off_topic" | "guardrail";

export type AnswerEvent =
  | { type: "token"; value: string }
  | { type: "citations"; citations: Citation[] }
  /**
   * `no_context`: retrieval returned nothing to answer from. `no_grounding`:
   * it returned something and the model declined to answer from it. The
   * widget shows the same copy for both; the distinction is for the people
   * maintaining the content, not the visitor.
   */
  | { type: "refusal"; reason: RefusalReason }
  /**
   * The context answered the question in more than one way, so the engine
   * asks which the visitor meant (spec: clarifying-questions). `options` are
   * titles of retrieved pages; sending one back as the next message is the
   * whole protocol. Emitted instead of `token`/`citations`, before `done`.
   */
  | { type: "clarify"; question: string; options: string[] }
  /**
   * A tool call on the visitor's behalf (spec: mcp-actions): one event when
   * it starts, one when it ends. `id` is the audit row the call became.
   */
  | { type: "action"; id: string; title: string; status: ActionCallStatus }
  /**
   * The turn paused on a tool that needs the visitor's confirmation. The
   * widget renders a card; the answer comes back as a new ask carrying
   * `approval`. `expiresAt` is when the request stops being answerable.
   */
  | {
      type: "confirm";
      id: string;
      title: string;
      summary: string;
      /** The arguments as rows for the card, named for the visitor. */
      details: ActionDetail[];
      input: Record<string, unknown>;
      expiresAt?: string;
    }
  /**
   * The answer named things the documentation does not contain (spec:
   * answer-verification): bold names and identifiers found neither in the
   * retrieved blocks nor anywhere in the corpus. Emitted after `citations`
   * and before `done`, and only when the list is non-empty — a clean answer
   * looks exactly as it always did. The widget speaks it as a sentence in
   * the assistant's voice, not as a badge.
   */
  | { type: "verification"; unsupportedTerms: string[] }
  | { type: "done"; conversationId: string; messageId: string };

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Server-side validation of a project's stored widget appearance — derived
 * from the same `WIDGET_OPTIONS` descriptor the widget parses attributes with,
 * so the two can never disagree. `clientOnly` options (identity + branding)
 * are rejected: a project admin does not get to set their own `poweredBy`.
 *
 * Unknown keys are rejected rather than stripped, so a typo in an API call
 * surfaces instead of silently doing nothing.
 */
const cssValue = z
  .string()
  .max(200)
  .regex(/^[^;{}<>"'\\@]*$/, "CSS syntax characters are not allowed");

function fieldSchema(option: WidgetOption): z.ZodType {
  switch (option.kind) {
    case "string":
      return z.string().max(400);
    case "css":
      return cssValue;
    case "int":
      return z
        .number()
        .int()
        .min(0)
        .max(option.max ?? 4096);
    case "boolean":
      return z.boolean();
    case "enum":
      return z.enum(option.values as readonly [string, ...string[]]);
    case "stringList":
      return z.array(z.string().min(1).max(200)).max(option.max ?? 8);
    case "theme":
      return z.partialRecord(z.enum(TOKENS), cssValue);
    case "copy":
      return z.partialRecord(z.enum(COPY_KEYS), z.string().max(400));
    case "promptGroups":
      return z.array(PromptGroupSchema).max(PROMPT_GROUP_LIMITS.groups);
    case "reasons":
      return z.array(FeedbackReasonOptionSchema).max(FEEDBACK_REASON_LIMITS.reasons);
    case "context":
      return ConversationContextSchema;
  }
}

export const PromptGroupSchema = z.object({
  title: z.string().min(1).max(PROMPT_GROUP_LIMITS.title),
  description: z.string().max(PROMPT_GROUP_LIMITS.description).optional(),
  icon: z
    .string()
    .max(PROMPT_GROUP_LIMITS.icon)
    .regex(/^(https?:\/\/|data:image\/)/i, "Icons are http(s) or data:image URLs")
    .optional(),
  prompts: z
    .array(z.string().min(1).max(PROMPT_GROUP_LIMITS.prompt))
    .min(1)
    .max(PROMPT_GROUP_LIMITS.prompts),
});

export const FeedbackReasonOptionSchema = z.object({
  id: z.string().regex(REASON_ID_PATTERN),
  label: z.string().min(1).max(FEEDBACK_REASON_LIMITS.label),
  note: z.number().int().min(0).max(FEEDBACK_REASON_LIMITS.note).optional(),
});

export const WidgetAppearanceSchema = z.strictObject(
  Object.fromEntries(
    WIDGET_OPTIONS.filter((o) => !o.clientOnly).map((o) => [o.key, fieldSchema(o).optional()]),
  ),
) as z.ZodType<Partial<WidgetAppearance>>;
