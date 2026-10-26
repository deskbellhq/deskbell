/**
 * Generates apps/docs/public/openapi.json for the public widget API.
 *
 * Request bodies come from the zod schemas in packages/shared, the same ones
 * the routes validate with, so the document cannot describe a field the
 * server does not accept. Responses are zod schemas here, typed against the
 * interfaces the routes return (`z.ZodType<WidgetMessage>` and friends), so a
 * change to a response type fails `pnpm typecheck` until this file follows.
 * Field descriptions live in this file; a field without one fails the run.
 *
 * `--check` fails instead of writing, which is what CI runs.
 *
 * Usage: pnpm docs:openapi [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  type AnswerEvent,
  AskRequestSchema,
  type Citation,
  CitationSchema,
  ConversationContextSchema,
  ConversationDeleteRequestSchema,
  ConversationListRequestSchema,
  ConversationMessagesRequestSchema,
  type ConversationPreview,
  ConversationPreviewRequestSchema,
  ConversationRenameRequestSchema,
  FeedbackRequestSchema,
  PingRequestSchema,
  type WidgetConversation,
  type WidgetMessage,
} from "../packages/shared/src/index";

const OUT = new URL("../apps/docs/public/openapi.json", import.meta.url).pathname;

// --- Descriptions -----------------------------------------------------------

const COMMON = {
  projectKey: "The project's public key, as printed in the embed snippet. Public by design.",
  sessionId:
    "An identifier the client generated and keeps (the widget stores it in localStorage). A conversation belongs to the session that created it.",
  conversationId: "The conversation to act on. Must belong to the caller, or the response is 404.",
};

const DESCRIPTIONS: Record<string, Record<string, string>> = {
  ask: {
    ...COMMON,
    conversationId:
      "Continue this conversation. Omit to start a new one. Must belong to the caller, or the response is 404.",
    message: "The visitor's question, up to 4000 characters.",
    locale: "BCP 47 tag of the visitor's UI language. Retrieval is cross-language.",
    context:
      "Where on your site the conversation starts, as identifiers keyed by name. Stored on a new conversation only and ignored when continuing one.",
    approval:
      "The visitor's answer to a `confirm` event: the call id and whether to go ahead. Continues the turn that paused in `conversationId`; `message` may be empty. A call that is not pending there, or has expired, is 404.",
  },
  conversations: {
    ...COMMON,
    scope: "Keep only conversations whose stored context carries this key with this id.",
    limit: "How many to return, 1 to 50. Default 20.",
  },
  messages: COMMON,
  rename: { ...COMMON, title: "The new title, 1 to 120 characters, trimmed." },
  delete: COMMON,
  preview: {
    ...COMMON,
    conversationId:
      "Any conversation of the project. Requires a bearer token carrying the project's staff claim.",
  },
  feedback: {
    projectKey: COMMON.projectKey,
    sessionId: "Must match the conversation's session: possession is the authorization.",
    messageId: "The assistant message being rated, from the ask stream's `done` event.",
    feedback: "The vote. `null` clears a previous one.",
    reason:
      "A downvote reason id: one the project configured, or the built-in `incorrect`, `irrelevant` or `unaddressed`. Kept only with `down`.",
    comment: "Free text with a downvote, up to 1000 characters. Kept only with `down`.",
  },
  ping: { projectKey: COMMON.projectKey },
};

// --- Response schemas, pinned to the interfaces the routes return ------------

const contextSchema = ConversationContextSchema;

const citation = CitationSchema satisfies z.ZodType<Citation>;

const widgetConversation = z.object({
  id: z.string(),
  title: z.string().describe("The stored title, else the first user message."),
  snippet: z.string().describe("The last message, truncated server-side."),
  lastMessageAt: z.string().describe("ISO timestamp of the latest activity."),
  context: contextSchema
    .nullable()
    .optional()
    .describe("Context attached when the conversation was created."),
  updatedAt: z.string().optional().describe("ISO timestamp of the conversation row's last update."),
}) satisfies z.ZodType<WidgetConversation>;

const widgetMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z
    .array(citation)
    .nullable()
    .describe("The sources the model used. Null on user messages and refusals."),
  refused: z
    .boolean()
    .describe("True when the assistant declined to answer from the retrieved content."),
  feedback: z.enum(["up", "down"]).nullable(),
  feedbackReason: z
    .string()
    .nullable()
    .optional()
    .describe("The downvote reason id, when one was given."),
  createdAt: z.string(),
  actions: z
    .array(
      z.object({
        id: z.string().describe("The call, as `approval.callId` names it."),
        title: z.string().describe("The tool's title, as shown to the visitor."),
        status: z.enum([
          "running",
          "succeeded",
          "failed",
          "pending_approval",
          "approved",
          "denied",
          "expired",
        ]),
        summary: z
          .string()
          .optional()
          .describe("One line naming the call, for a confirmation card."),
        details: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional()
          .describe("The call's arguments as the confirmation card lists them."),
        expiresAt: z
          .string()
          .optional()
          .describe("ISO timestamp after which a pending request can no longer be answered."),
      }),
    )
    .optional()
    .describe("Tool calls the answer made or asked about. Absent when none."),
  unsupportedTerms: z
    .array(z.string())
    .optional()
    .describe(
      "Names the answer asserted that the documentation does not contain. Absent when none.",
    ),
}) satisfies z.ZodType<WidgetMessage>;

const conversationPreview = z.object({
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    context: contextSchema.nullable(),
    createdAt: z.string(),
  }),
  endUser: z
    .object({ name: z.string().nullable(), email: z.string().nullable() })
    .nullable()
    .describe("The signed-in visitor the conversation belongs to, when it has one."),
  messages: z.array(widgetMessage),
}) satisfies z.ZodType<ConversationPreview>;

const answerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), value: z.string() }),
  z.object({ type: z.literal("citations"), citations: z.array(citation) }),
  z.object({
    type: z.literal("refusal"),
    reason: z.enum(["no_context", "no_grounding", "off_topic", "guardrail", "no_access"]),
    text: z
      .string()
      .optional()
      .describe(
        "What to show instead of the refusal copy: the project's own reply to a `no_access` refusal, the question needing the visitor's data that nothing on the turn could read.",
      ),
  }),
  z.object({
    type: z.literal("verification"),
    unsupportedTerms: z
      .array(z.string())
      .describe(
        "Names the answer asserted that were found neither in the retrieved content nor anywhere in the corpus. Sent after `citations`, only when non-empty.",
      ),
  }),
  z.object({ type: z.literal("done"), conversationId: z.string(), messageId: z.string() }),
]) satisfies z.ZodType<AnswerEvent>;

const errorBody = z.object({ error: z.string(), reason: z.string().optional() });
const rateLimited = z.object({
  error: z.literal("Rate limited"),
  retryAfter: z
    .number()
    .int()
    .describe("Seconds until the caller may try again; also sent as Retry-After."),
});

// --- Assembly -----------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchema;
  json.$schema = undefined;
  return json;
}

function requestSchema(name: string, schema: z.ZodObject): JsonSchema {
  const json = toSchema(schema);
  const props = json.properties as Record<string, JsonSchema>;
  const descriptions = DESCRIPTIONS[name] ?? {};
  for (const key of Object.keys(props)) {
    const description = descriptions[key];
    if (!description) throw new Error(`${name}: no description for request field "${key}"`);
    props[key] = { ...props[key], description };
  }
  return json;
}

const guardResponses = {
  400: { description: "The body failed validation.", body: errorBody },
  401: {
    description:
      "The project requires a visitor token and none was sent, or it failed verification. `reason` is `missing` or `invalid`.",
    body: errorBody,
  },
  403: {
    description:
      "The User-Agent looks like a crawler or an HTTP library, or the Origin is not on the project's allowlist.",
    body: errorBody,
  },
  404: {
    description: "Unknown project key, or a conversation the caller does not own.",
    body: errorBody,
  },
  429: {
    description:
      "A rate limit, the project's daily token budget, or the per-address stream cap. Retry-After says when.",
    body: rateLimited,
    headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds." } },
  },
};

function jsonResponse(description: string, schema: z.ZodType) {
  return { description, content: { "application/json": { schema: toSchema(schema) } } };
}

function responses(codes: (keyof typeof guardResponses)[], ok: Record<string, unknown>) {
  const out: Record<string, unknown> = { "200": ok };
  for (const code of codes) {
    const r = guardResponses[code];
    out[String(code)] = {
      description: r.description,
      ...("headers" in r ? { headers: r.headers } : {}),
      content: { "application/json": { schema: toSchema(r.body) } },
    };
  }
  return out;
}

function post(
  name: string,
  summary: string,
  description: string,
  body: z.ZodObject,
  ok: Record<string, unknown>,
  codes: (keyof typeof guardResponses)[],
  extra: Record<string, unknown> = {},
) {
  return {
    post: {
      operationId: name,
      summary,
      description,
      requestBody: {
        required: true,
        content: { "application/json": { schema: requestSchema(name, body) } },
      },
      responses: responses(codes, ok),
      ...extra,
    },
  };
}

const READ: (keyof typeof guardResponses)[] = [400, 401, 403, 404, 429];

const document = {
  openapi: "3.1.0",
  info: {
    title: "Deskbell widget API",
    version: "1",
    description:
      "The public API of a Deskbell instance: what the widget and the SDK call. It reads no cookies. Every route accepts OPTIONS for preflight; POST routes require an Origin header on the project's allowlist. Generated from the schemas the server validates with.",
  },
  servers: [{ url: "https://your-deskbell.example.com", description: "Your instance" }],
  tags: [
    { name: "Ask", description: "The one call that spends model tokens." },
    { name: "Conversations", description: "The caller's own threads." },
    { name: "Feedback" },
    { name: "Install" },
  ],
  paths: {
    "/api/v1/ask": post(
      "ask",
      "Ask a question",
      "Streams the answer as server-sent events: `token` events, then `citations` or a `refusal`, then `done` with the ids feedback refers to. Lines beginning with a colon are heartbeat comments. Runs every guard, plus the daily token budget and the per-address stream cap.",
      AskRequestSchema,
      {
        description: "An event stream. Each `data:` line is one JSON event.",
        content: {
          "text/event-stream": {
            schema: { ...toSchema(answerEvent), description: "One event per data: line." },
          },
        },
      },
      READ,
      { tags: ["Ask"] },
    ),
    "/api/v1/config": {
      get: {
        operationId: "config",
        tags: ["Install"],
        summary: "Read the widget appearance",
        description:
          "The project's widget appearance as saved on the Appearance page, plus `poweredBy`, which the server decides. Cached for 60 seconds.",
        parameters: [
          {
            name: "key",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: COMMON.projectKey,
          },
        ],
        responses: responses([403, 404, 429], {
          description: "The appearance object. Keys are the widget options in camelCase.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                required: ["poweredBy"],
                properties: {
                  poweredBy: {
                    type: "boolean",
                    description: "Whether the Powered by Deskbell badge renders.",
                  },
                },
              },
            },
          },
        }),
      },
    },
    "/api/v1/conversations": post(
      "conversations",
      "List the caller's conversations",
      "Newest activity first. `scope` keeps only conversations whose stored context carries a key with a given id.",
      ConversationListRequestSchema,
      jsonResponse(
        "The caller's conversations.",
        z.object({ conversations: z.array(widgetConversation) }),
      ),
      READ,
      { tags: ["Conversations"] },
    ),
    "/api/v1/conversations/messages": post(
      "messages",
      "Replay a conversation",
      "Every message of one conversation, in order, with each answer's citations, refusal flag and feedback.",
      ConversationMessagesRequestSchema,
      jsonResponse("The messages.", z.object({ messages: z.array(widgetMessage) })),
      READ,
      { tags: ["Conversations"] },
    ),
    "/api/v1/conversations/rename": post(
      "rename",
      "Rename a conversation",
      "Sets the title the widget's sidebar and the dashboard show.",
      ConversationRenameRequestSchema,
      jsonResponse("Renamed.", z.object({ ok: z.literal(true), title: z.string() })),
      READ,
      { tags: ["Conversations"] },
    ),
    "/api/v1/conversations/delete": post(
      "delete",
      "Delete a conversation",
      "Soft-deletes the conversation for the caller.",
      ConversationDeleteRequestSchema,
      jsonResponse("Deleted.", z.object({ ok: z.literal(true) })),
      READ,
      { tags: ["Conversations"] },
    ),
    "/api/v1/conversations/preview": post(
      "preview",
      "Read any conversation as staff",
      "For a bearer token that carries the project's configured staff claim. Returns the conversation, its signed-in visitor if any, and every message. 403 without the claim.",
      ConversationPreviewRequestSchema,
      jsonResponse("The conversation.", conversationPreview),
      READ,
      { tags: ["Conversations"] },
    ),
    "/api/v1/feedback": post(
      "feedback",
      "Vote on an answer",
      "Upserts the vote on one assistant message. A `down` vote is what notifications fire on and what the Gaps page counts.",
      FeedbackRequestSchema,
      jsonResponse("Recorded.", z.object({ ok: z.literal(true) })),
      READ,
      { tags: ["Feedback"] },
    ),
    "/api/v1/ping": {
      post: {
        operationId: "ping",
        tags: ["Install"],
        summary: "Install beacon",
        description:
          "Sent once per tab session when the widget mounts. Records the request's Origin against the project so the Install page can show where the widget is live, including hosts not on the allowlist. Diagnostic only; grants nothing and skips the allowlist and identity checks.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: requestSchema("ping", PingRequestSchema) } },
        },
        responses: {
          "204": { description: "Recorded." },
          "400": guardResponses[400] && {
            description: guardResponses[400].description,
            content: { "application/json": { schema: toSchema(errorBody) } },
          },
          "403": { description: "The User-Agent looks like a crawler or an HTTP library." },
          "404": { description: "Unknown project key." },
          "429": { description: "Rate limited." },
        },
      },
    },
  },
};

const text = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // Missing file fails below like a stale one.
  }
  if (current !== text) {
    console.error("apps/docs/public/openapi.json is stale. Run: pnpm docs:openapi");
    process.exit(1);
  }
  console.log("apps/docs/public/openapi.json is current.");
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${OUT}`);
}
