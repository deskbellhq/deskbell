// Type-only imports — erased at build. The SDK has no runtime dependencies,
// which is what lets the widget inline it (spec: sdk-client).
import type {
  AnswerEvent,
  ConversationContext,
  ConversationPreview,
  FeedbackRequest,
  WidgetConversation,
  WidgetMessage,
} from "@deskbell/shared";
import { DeskbellError, retryAfterSeconds } from "./errors";
import { readSse } from "./sse";

export type {
  AnswerEvent,
  Citation,
  ConversationContext,
  ConversationPreview,
  FeedbackReason,
  FeedbackRequest,
  RefusalReason,
  WidgetConversation,
  WidgetMessage,
} from "@deskbell/shared";
export { DeskbellError } from "./errors";
export { readSse } from "./sse";

export interface DeskbellClientOptions {
  /** Origin of the Deskbell server, no trailing slash. Empty means same origin. */
  baseUrl?: string;
  /** Public project key; the server binds it to allowed origins. */
  projectKey: string;
  /**
   * Visitor session. Possession is what authorises reading and rating a
   * conversation. A function is called once, on first use, so a caller can
   * mint the session lazily the way the widget does.
   */
  sessionId?: string | (() => string);
  /**
   * The signed-in visitor's bearer token, asked for before every request and
   * sent as `Authorization: Bearer` when it returns one. The server verifies
   * it against the project's identity provider; a verified visitor owns their
   * conversations across devices. Return nothing for an anonymous visitor.
   */
  getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Override for tests and non-browser runtimes. Defaults to the global. */
  fetch?: typeof fetch;
}

export interface ListOptions {
  /** Only conversations whose context carries this key with this id. */
  scope?: { key: string; id: string };
  /** 1 to 50; the server's default is 20. */
  limit?: number;
}

export interface AskInput {
  /** The question. Empty when `approval` answers a confirmation request. */
  message: string;
  /** Continue this thread; absent starts a new conversation. */
  conversationId?: string;
  /**
   * The visitor's answer to a `confirm` event (spec: mcp-actions): continues
   * the turn that paused in `conversationId`. The server streams the rest of
   * the answer as usual.
   */
  approval?: { callId: string; approved: boolean };
  /** BCP 47 tag of the UI language. */
  locale?: string;
  /** Attached to a new conversation only: where on the host it started. */
  context?: ConversationContext;
}

export interface AskOptions {
  signal?: AbortSignal;
}

export type FeedbackInput = Omit<FeedbackRequest, "projectKey" | "sessionId">;

/**
 * Typed client for the public Deskbell API. MIT-licensed; the widget runs on
 * it, and so can any custom UI. One method per public endpoint, nothing the
 * server does not answer.
 */
export class DeskbellClient {
  readonly conversations = {
    /** The caller's recent conversations, newest first. */
    list: async (options: ListOptions = {}): Promise<WidgetConversation[]> => {
      const data = await this.post<{ conversations: WidgetConversation[] }>(
        "/api/v1/conversations",
        { scope: options.scope, limit: options.limit },
      );
      return data.conversations;
    },
    /** Every message of one conversation the caller owns. */
    messages: async (conversationId: string): Promise<WidgetMessage[]> => {
      const data = await this.post<{ messages: WidgetMessage[] }>(
        "/api/v1/conversations/messages",
        { conversationId },
      );
      return data.messages;
    },
    /** Removes a conversation from the caller's history. */
    delete: async (conversationId: string): Promise<void> => {
      await this.post<unknown>("/api/v1/conversations/delete", { conversationId });
    },
    /** Gives a conversation a title of the caller's choosing. */
    rename: async (conversationId: string, title: string): Promise<void> => {
      await this.post<unknown>("/api/v1/conversations/rename", { conversationId, title });
    },
    /**
     * Any conversation of the project, read-only, for a caller whose token
     * carries the project's staff claim. 403 for everyone else.
     */
    preview: (conversationId: string): Promise<ConversationPreview> =>
      this.post<ConversationPreview>("/api/v1/conversations/preview", { conversationId }),
  };

  private readonly baseUrl: string;
  private readonly projectKey: string;
  private session: string | (() => string) | undefined;
  private readonly getAuthToken: DeskbellClientOptions["getAuthToken"];
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeskbellClientOptions) {
    this.baseUrl = options.baseUrl ?? "";
    this.projectKey = options.projectKey;
    this.session = options.sessionId;
    this.getAuthToken = options.getAuthToken;
    // Called as a free function, never as a method: browsers refuse a native
    // fetch invoked with this client as `this` ("Illegal invocation").
    const impl = options.fetch;
    this.fetchImpl = impl
      ? (input, init) => impl(input, init)
      : (input, init) => fetch(input, init);
  }

  /** Request headers: JSON, plus the bearer when the visitor has one. */
  private async headers(json = true): Promise<Record<string, string>> {
    const out: Record<string, string> = json ? { "content-type": "application/json" } : {};
    const token = await this.getAuthToken?.();
    if (token) out.authorization = `Bearer ${token}`;
    return out;
  }

  /** The session id in use, resolving a lazy one on first call. */
  get sessionId(): string {
    if (typeof this.session === "function") this.session = this.session();
    if (!this.session) throw new DeskbellError(0, "Deskbell client has no sessionId");
    return this.session;
  }

  /** Appearance authored in the dashboard for this project. Raw; coerce it yourself. */
  async config(options: AskOptions = {}): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/api/v1/config?key=${encodeURIComponent(this.projectKey)}`;
    const res = await this.fetchImpl(url, {
      headers: await this.headers(false),
      signal: options.signal,
    });
    if (!res.ok) throw new DeskbellError(res.status, undefined, retryAfterSeconds(res));
    return (await res.json()) as Record<string, unknown>;
  }

  /** Stream an answer. Throws `DeskbellError` before the first event on a non-2xx status. */
  async *ask(input: AskInput, options: AskOptions = {}): AsyncIterable<AnswerEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/ask`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        projectKey: this.projectKey,
        sessionId: this.sessionId,
        conversationId: input.conversationId,
        message: input.message,
        locale: input.locale,
        context: input.context,
        approval: input.approval,
      }),
      signal: options.signal,
    });
    if (!res.ok || !res.body) {
      throw new DeskbellError(res.status, undefined, retryAfterSeconds(res));
    }
    yield* readSse(res.body);
  }

  /** Rate an assistant message. Upsert: `feedback: null` clears the vote. */
  async feedback(input: FeedbackInput): Promise<void> {
    await this.post<unknown>("/api/v1/feedback", input);
  }

  /**
   * Install beacon: tells the dashboard the widget is live on this origin.
   * Diagnostic only, never authorisation.
   */
  async ping(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/ping`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ projectKey: this.projectKey }),
    });
    if (!res.ok) throw new DeskbellError(res.status, undefined, retryAfterSeconds(res));
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ projectKey: this.projectKey, sessionId: this.sessionId, ...payload }),
    });
    if (!res.ok) throw new DeskbellError(res.status, undefined, retryAfterSeconds(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
