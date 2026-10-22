import { createMCPClient, type InitializeResult, type MCPClient } from "@ai-sdk/mcp";
import type { actionServers } from "@deskbell/db";
import {
  ACTION_IDENTITY_HEADER,
  ACTION_LIMITS,
  type ActionServerInfo,
  type ActionToolDefinition,
  ActionToolDefinitionSchema,
  validateWebhookUrl,
} from "@deskbell/shared";

/**
 * The MCP client side of actions (spec: mcp-actions). Remote servers only,
 * over Streamable HTTP or the older SSE transport; credentials ride in a
 * header the operator chose; the visitor, when the server asks for one,
 * rides in `X-Deskbell-Identity` or, for a server that is a resource server
 * of the visitor's own identity provider, as the bearer itself (spec:
 * visitor-token-actions). Redirects are refused and the URL passes the
 * webhook checks, so a server cannot point the instance at something on its
 * own network.
 *
 * A client here is cheap to make: with the stored initialize result the
 * transport starts without a handshake, and the tool list comes from the
 * row. Nothing touches the network until a tool is called or a refresh asks
 * for the list. The exception is a server on the newer protocol revision,
 * which gets its handshake every time (see `reusableInitializeResult`).
 */

export type ActionServerRow = typeof actionServers.$inferSelect;

/** The columns a connection needs; a test hands in a literal. */
export type ActionServerConnection = Pick<
  ActionServerRow,
  | "id"
  | "slug"
  | "url"
  | "transport"
  | "authKind"
  | "authHeaderName"
  | "authSecret"
  | "identity"
  | "exchangeClientId"
  | "exchangeClientSecret"
  | "exchangeAudience"
  | "exchangeScope"
  | "initializeResult"
>;

/**
 * The first protocol revision whose handshake is `server/discover` and whose
 * requests carry a `_meta` envelope. A stored initialize result from such a
 * server cannot stand in for the handshake: the client library applies every
 * stored result as the older era, so the calls that follow go out without
 * the envelope and the server rejects each one. Revisions are dates, so a
 * string comparison orders them.
 */
export const FIRST_ENVELOPE_PROTOCOL_VERSION = "2026-07-28";

/**
 * The stored initialize result when it may replace the handshake, undefined
 * when the server must be initialized again: a result from the newer
 * revision, or one with no readable revision at all.
 */
export function reusableInitializeResult(stored: unknown): InitializeResult | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const version = (stored as { protocolVersion?: unknown }).protocolVersion;
  if (typeof version !== "string" || version >= FIRST_ENVELOPE_PROTOCOL_VERSION) return undefined;
  return stored as InitializeResult;
}

export const DISCOVERY_TIMEOUT_MS = 5000;
export const INITIALIZE_TIMEOUT_MS = 3000;

export function authHeaders(server: ActionServerConnection): Record<string, string> {
  if (server.authKind === "bearer" && server.authSecret) {
    return { authorization: `Bearer ${server.authSecret}` };
  }
  if (server.authKind === "header" && server.authHeaderName && server.authSecret) {
    return { [server.authHeaderName.toLowerCase()]: server.authSecret };
  }
  return {};
}

export interface ConnectOptions {
  /** A signed visitor identity, sent on every request to this server. */
  identityToken?: string;
  /**
   * A token the server accepts as its bearer: the visitor's own (exchanged
   * or forwarded), or the one-time token an operator pasted for discovery.
   * Takes the `authorization` header; a bearer credential is refused with
   * it at validation time, a header credential rides alongside.
   */
  bearerToken?: string;
  /** Skip the stored initialize result and perform the handshake. */
  fresh?: boolean;
  fetch?: typeof fetch;
}

export async function connectActionServer(
  server: ActionServerConnection,
  opts: ConnectOptions = {},
): Promise<MCPClient> {
  const check = validateWebhookUrl(server.url);
  if (!check.ok) throw new Error(`Server URL: ${check.reason}`);
  const headers = {
    ...authHeaders(server),
    ...(opts.bearerToken ? { authorization: `Bearer ${opts.bearerToken}` } : {}),
    ...(opts.identityToken ? { [ACTION_IDENTITY_HEADER]: opts.identityToken } : {}),
  };
  const initialInitializeResult =
    !opts.fresh && server.transport === "http"
      ? reusableInitializeResult(server.initializeResult)
      : undefined;
  return createMCPClient({
    clientName: "deskbell",
    transport: {
      type: server.transport,
      url: check.url,
      headers,
      redirect: "error",
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    },
    maxRetries: 0,
    initializationOptions: { timeout: INITIALIZE_TIMEOUT_MS },
    ...(initialInitializeResult ? { initialInitializeResult } : {}),
  });
}

export interface Discovery {
  tools: ActionToolDefinition[];
  serverInfo: ActionServerInfo;
  initializeResult: Record<string, unknown>;
}

/**
 * Initialize and list every tool, as the settings page's refresh does. The
 * server's `instructions` are deliberately not kept: they are text the
 * model would read, from a party the operator has not vetted. A server that
 * only answers to a visitor's token is listed with a token the operator
 * pasted for this one call.
 */
export async function discoverActionServer(
  server: ActionServerConnection,
  opts: Pick<ConnectOptions, "fetch" | "bearerToken"> = {},
): Promise<Discovery> {
  const client = await connectActionServer(server, { ...opts, fresh: true });
  try {
    const tools: ActionToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({
        params: cursor ? { cursor } : undefined,
        options: { timeout: DISCOVERY_TIMEOUT_MS },
      });
      for (const raw of page.tools) {
        const parsed = ActionToolDefinitionSchema.safeParse({
          name: raw.name,
          title: raw.title,
          description: raw.description,
          inputSchema: raw.inputSchema,
          annotations: raw.annotations,
        });
        if (parsed.success) tools.push(parsed.data);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && tools.length < ACTION_LIMITS.tools);
    const info = client.serverInfo;
    const init = client.initializeResult as unknown as Record<string, unknown>;
    return {
      tools: tools.slice(0, ACTION_LIMITS.tools),
      serverInfo: {
        name: info.name,
        version: info.version,
        ...(info.title ? { title: info.title } : {}),
        ...(typeof init.protocolVersion === "string"
          ? { protocolVersion: init.protocolVersion }
          : {}),
      },
      initializeResult: init,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** What a tool call produced, in the shape the engine and the audit row want. */
export interface NormalizedResult {
  output: unknown;
  error?: string;
}

/**
 * An MCP result is a list of content blocks plus an optional structured
 * payload. The structured payload is the output when present; otherwise the
 * text blocks, joined — one string when there is one block, so a plain
 * answer stays plain. `isError` becomes an error the model is told about.
 */
export function normalizeToolResult(result: unknown): NormalizedResult {
  if (!result || typeof result !== "object") return { output: result };
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const texts = (r.content ?? [])
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  const output =
    r.structuredContent !== undefined
      ? r.structuredContent
      : texts.length === 1
        ? texts[0]
        : texts.length > 1
          ? texts.join("\n")
          : (r.content ?? null);
  if (r.isError) {
    return { output: null, error: texts.join("\n").slice(0, 500) || "The tool reported an error" };
  }
  return { output };
}
