// The SDK is the widget's only transport (spec: sdk-client). It is
// dependency-free and inlined at build time, so the runtime bundle still
// carries nothing third-party beyond preact (AGENTS rule 5). Everything from
// @deskbell/shared is a type-only import, erased at build.
import { DeskbellClient, type DeskbellClientOptions, DeskbellError } from "@deskbell/sdk";
import type { Citation, WidgetAction, WidgetConversation, WidgetMessage } from "@deskbell/shared";
// A value import, from the one module of @deskbell/shared that carries no zod.
import { ACTION_CITATION_KIND, CORRECTIONS_SOURCE_TYPE } from "@deskbell/shared/source-types";
// Dependency-free by its own rules, so a value import costs nothing (AGENTS rule 5).
import { UNSUPPORTED_NOTE_DEFAULT, type WidgetConfig } from "@deskbell/shared/widget-config";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { clampToViewport, isDrag, type Point, toDockOffsets } from "./drag.ts";
import { Markdown } from "./markdown/render.tsx";
import { readScheme, SCHEME_ATTRIBUTES } from "./scheme.ts";
import { Sidebar } from "./sidebar.tsx";
import { CSS } from "./styles.ts";

interface PanelProps {
  /** Fully resolved config: defaults < server < attributes < JS calls. */
  config: WidgetConfig;
  /** `--_cfg-*` declarations for the generated stylesheet (see ./styles.ts). */
  cssVars: string;
  /** Hands imperative controls back to the host element on every render. */
  onControls?: (controls: PanelControls) => void;
  /** Rewrites an answer's Markdown before it renders (spec: answer-markdown). */
  answerTransform?: (markdown: string) => string;
  /** Names of the slots the host page filled; decides layout in inline mode. */
  slots?: ReadonlySet<string>;
  /** The custom element; outbound events are dispatched on it and bubble to window. */
  host?: HTMLElement;
  /** The signed-in visitor's bearer token, handed to the SDK client (spec: end-user-identity). */
  getAuthToken?: DeskbellClientOptions["getAuthToken"];
}

export interface OpenOptions {
  /** Prefill the composer, or ask it straight away with `submit`. */
  query?: string;
  submit?: boolean;
}

/** What the element (and through it, `window.deskbell(...)`) can drive. */
export interface PanelControls {
  open(options?: OpenOptions): void;
  close(): void;
  toggle(): void;
  ask(question: string): void;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Persisted message id from the stream's `done` event — keys feedback votes. */
  id?: string;
  citations?: Citation[];
  refused?: boolean;
  pending?: boolean;
  feedback?: "up" | "down" | null;
  feedbackReason?: string | null;
  /**
   * The engine asked which reading the visitor meant (spec:
   * clarifying-questions); `text` holds the question. Options render as
   * buttons while this is the latest message, and a tap asks the option.
   */
  clarify?: { question: string; options: string[] };
  /** Tool calls the answer made or asked about (spec: mcp-actions). */
  actions?: WidgetAction[];
  /**
   * What the model did before it answered, in order: reasoning it emitted
   * and the calls it made (spec: activity-disclosure). Actions are keyed
   * into `actions`; reasoning lives only here and only for this session.
   * Absent on a replayed message, whose `actions` then stand in.
   */
  trail?: TrailItem[];
  /** When the turn started, so the activity header can say how long it took. */
  startedAt?: number;
  /** From the start to the first thing said to the visitor, once known. */
  workedMs?: number;
  /** The visitor's own open/closed choice for the activity group; unset means automatic. */
  activityOpen?: boolean;
  /**
   * Names the answer asserted that the documentation does not contain (spec:
   * answer-verification). Spoken under the answer in the assistant's voice.
   */
  unsupportedTerms?: string[];
}

type TrailItem = { kind: "reasoning"; text: string } | { kind: "action"; id: string };

// Defaults for every overridable string; `config.copy` replaces any of them.
// Key names are pinned by COPY_KEYS in @deskbell/shared/widget-config.
const DEFAULT_COPY = {
  title: "Ask us anything",
  subtitle: "We answer from the docs — with sources.",
  placeholder: "Ask a question…",
  send: "Send",
  empty: "Answers come straight from the docs, with sources.",
  refusal: "I couldn't find an answer to that in the docs.",
  error: "Something went wrong — please try again.",
  limited: "That was a lot of questions — give it a moment and try again.",
  sources: "Sources",
  goodAnswer: "Good answer",
  badAnswer: "Not helpful",
  whatWrong: "What went wrong?",
  reasonIncorrect: "Inaccurate",
  reasonIrrelevant: "Not relevant",
  reasonUnaddressed: "Didn't answer my question",
  reasonPlaceholder: "Tell us more (optional)",
  reasonSend: "Send",
  reasonSkip: "Skip",
  recent: "Recent conversations",
  noRecent: "No conversations yet.",
  newQuestion: "Ask a new question",
  poweredBy: "Powered by Deskbell",
  welcomeTitle: "",
  feedbackNote: "",
  unsupportedNote: UNSUPPORTED_NOTE_DEFAULT,
  feedbackThanks: "Thanks for the feedback.",
  thinking: "Thinking",
  unauthorized: "Please sign in to continue.",
  threads: "Conversations",
  showThreads: "Show conversations",
  hideThreads: "Hide conversations",
  newChat: "New conversation",
  deleteThread: "Delete",
  confirmDelete: "Delete this conversation?",
  cancel: "Cancel",
  threadsError: "Couldn't load conversations.",
  retry: "Retry",
  scopeThis: "Here",
  scopeAll: "All",
  previewForbidden: "You don't have access to this conversation.",
  writtenAnswer: "Written answer",
  actionRunning: "Working…",
  actionDone: "Done",
  actionFailed: "Couldn't complete",
  actionConfirmTitle: "Confirm to continue",
  actionConfirm: "Confirm",
  actionDeny: "Cancel",
  actionApproved: "Confirmed",
  actionDenied: "Cancelled",
  actionExpired: "Expired",
  activityDone: "Worked for {s}s",
  activitySteps: "{n} steps",
  reasoning: "Reasoning",
};

/** `{name}` placeholders in a copy string, filled. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

const SESSION_KEY = "deskbell-session";

function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked (private mode) — in-memory session
  }
}

/** Last opened conversation, per project (spec: widget-conversation-history). */
const lastConvKey = (projectKey: string) => `deskbell-last-conv:${projectKey}`;

/**
 * How long a thread may sit silent before the next question starts a new one
 * (spec: sources-line-and-thread-status). Resuming the last thread forever
 * makes unrelated questions days apart share a conversation, which the model
 * then reads as one topic and the dashboard shows as one row. The old thread
 * stays in the recent list.
 */
const newestAt = (messages: WidgetMessage[]): number => {
  const last = messages[messages.length - 1];
  return last ? new Date(last.createdAt).getTime() : 0;
};

function getStoredConv(projectKey: string): string | null {
  try {
    return localStorage.getItem(lastConvKey(projectKey));
  } catch {
    return null;
  }
}

function storeConv(projectKey: string, id: string | null) {
  try {
    if (id) localStorage.setItem(lastConvKey(projectKey), id);
    else localStorage.removeItem(lastConvKey(projectKey));
  } catch {
    // storage blocked — continuity degrades to in-memory only
  }
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Replayed history → chat state. A refusal persists empty content by design
 * and is shown as the refusal copy; the one refusal that carries content is
 * the project's own reply to a question about the visitor's data, shown as
 * the assistant speaking, as it was live.
 */
function toChat(m: WidgetMessage, refusal: string): ChatMessage {
  const spoken = m.refused && Boolean(m.content);
  return {
    role: m.role,
    text: m.refused && !m.content ? refusal : m.content,
    id: m.id,
    citations: m.citations ?? undefined,
    refused: m.refused && !spoken,
    feedback: m.feedback,
    feedbackReason: m.feedbackReason ?? null,
    actions: m.actions,
    unsupportedTerms: m.unsupportedTerms,
  };
}

/**
 * The hedge under an answer that named things the documentation lacks (spec:
 * answer-verification): the operator's sentence with the names in place of
 * `{terms}`, each in bold, joined "A, B and C". A template without the
 * placeholder renders as written. Inside the bubble, in the assistant's
 * voice — the uncertainty is spoken, not badged.
 */
function Hedge({ template, terms }: { template: string; terms: string[] }) {
  const at = template.indexOf("{terms}");
  if (at === -1)
    return (
      <p class="hedge" part="hedge">
        {template}
      </p>
    );
  const names = terms.map((t, i) => (
    <span key={t}>
      {i === 0 ? "" : i === terms.length - 1 ? " and " : ", "}
      <strong>{t}</strong>
    </span>
  ));
  return (
    <p class="hedge" part="hedge">
      {template.slice(0, at)}
      {names}
      {template.slice(at + "{terms}".length)}
    </p>
  );
}

/** Whether a pending request can still be answered; the server refuses it after `expiresAt`. */
function isExpired(action: WidgetAction): boolean {
  return Boolean(action.expiresAt && new Date(action.expiresAt).getTime() < Date.now());
}

/** `part` value for a citation pill: the generic part plus one per source kind. */
function citationParts(kind: string | undefined): string {
  if (!kind) return "citation-pill";
  return `citation-pill citation-kind-${kind.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

/**
 * What a pill says (spec: answer-citation-labels). A page is its title. A
 * written answer's title is the question it answers, which would echo the
 * visitor back at them, so it carries a pen glyph and a second line naming
 * the kind of source.
 */
function PillBody({ citation: c, label }: { citation: Citation; label: string }) {
  if (c.kind !== CORRECTIONS_SOURCE_TYPE) return <>{c.title}</>;
  return (
    <>
      <svg
        class="pill-glyph"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
      </svg>
      <span class="pill-title">{c.title}</span>
      <span class="pill-label" part="citation-label">
        {label}
      </span>
    </>
  );
}

function pillClass(c: Citation): string {
  return c.kind === CORRECTIONS_SOURCE_TYPE ? "pill written" : "pill";
}

/** What a step line says for an action, from the copy table. */
function actionStatusCopy(action: WidgetAction, copy: typeof DEFAULT_COPY): string {
  switch (action.status) {
    case "running":
      return copy.actionRunning;
    case "succeeded":
      return copy.actionDone;
    case "failed":
      return copy.actionFailed;
    case "pending_approval":
      return isExpired(action) ? copy.actionExpired : copy.actionConfirmTitle;
    case "approved":
      return copy.actionApproved;
    case "denied":
      return copy.actionDenied;
    case "expired":
      return copy.actionExpired;
  }
}

/**
 * Whether a message needs its bubble. Text, a refusal and a message with no
 * calls always do. A message that only holds calls does not — and while one
 * of them is running, the step line's spinner already says the widget is
 * busy, so the typing dots wait until the model is writing again.
 */
function showBubble(m: ChatMessage): boolean {
  if (m.text || m.refused) return true;
  const busy = m.actions?.some((a) => a.status === "running") || hasReasoning(m);
  if (!m.actions?.length && !busy) return true;
  if (!m.pending) return false;
  return !busy;
}

function hasReasoning(m: ChatMessage): boolean {
  return m.trail?.some((t) => t.kind === "reasoning") ?? false;
}

/**
 * What the activity group shows, in order (spec: activity-disclosure): the
 * trail when the turn streamed here, else the stored calls. Open cards are
 * not steps — they render below, as cards.
 */
function activityGroups(m: ChatMessage): ActivityGroup[] {
  const byId = new Map((m.actions ?? []).map((a) => [a.id, a]));
  const trail: TrailItem[] =
    m.trail ?? (m.actions ?? []).map((a) => ({ kind: "action", id: a.id }));
  const out: ActivityGroup[] = [];
  for (const item of trail) {
    if (item.kind === "reasoning") {
      if (item.text.trim()) out.push(item);
      continue;
    }
    const action = byId.get(item.id);
    if (!action || isOpenCard(action)) continue;
    const last = out[out.length - 1];
    if (last?.kind === "steps") last.actions.push(action);
    else out.push({ kind: "steps", actions: [action] });
  }
  return out;
}

/** A run of consecutive step lines, or a block of reasoning between them. */
type ActivityGroup =
  | { kind: "reasoning"; text: string }
  | { kind: "steps"; actions: WidgetAction[] };

/**
 * The group stays open while the model is still at it and folds once it has
 * started answering, as the visitor's attention moves to the answer. Their
 * own toggle, if they made one, wins (see `activityOpen`).
 */
function activityAutoOpen(m: ChatMessage): boolean {
  return Boolean(m.pending) || (m.actions?.some((a) => a.status === "running") ?? false);
}

/** How long the model worked, in whole seconds, never zero once it is known. */
function workedSeconds(m: ChatMessage): number | null {
  if (m.workedMs === undefined) return null;
  return Math.max(1, Math.round(m.workedMs / 1000));
}

/** Marks the moment the visitor first heard something, once per message. */
function settle(m: ChatMessage): ChatMessage {
  if (m.workedMs !== undefined || m.startedAt === undefined) return m;
  return { ...m, workedMs: Date.now() - m.startedAt };
}

/** The trail with this call in it, appended if it was not there yet. */
function withStep(trail: TrailItem[] | undefined, id: string): TrailItem[] {
  const current = trail ?? [];
  return current.some((t) => t.kind === "action" && t.id === id)
    ? current
    : [...current, { kind: "action", id }];
}

/** The trail with this reasoning on it, extending the segment the model is still writing. */
function withReasoning(trail: TrailItem[] | undefined, value: string): TrailItem[] {
  const current = trail ?? [];
  const last = current[current.length - 1];
  if (last?.kind === "reasoning") {
    return [...current.slice(0, -1), { kind: "reasoning", text: last.text + value }];
  }
  return [...current, { kind: "reasoning", text: value }];
}

/** A call waiting for the visitor: a card, not a step line. */
function isOpenCard(action: WidgetAction): boolean {
  return action.status === "pending_approval" && !isExpired(action);
}

/**
 * Whether a step's status word carries information the glyph does not. A
 * spinner and a check speak for themselves; the word stays in the DOM for
 * assistive tech either way.
 */
function statusIsQuiet(status: WidgetAction["status"]): boolean {
  return status === "running" || status === "succeeded";
}

/** The glyph on a step line (spec: action-presentation). */
function StepGlyph({ status }: { status: WidgetAction["status"] }) {
  if (status === "running") return <i class="spin" aria-hidden="true" />;
  let path: string;
  if (status === "succeeded" || status === "approved") path = "M20 6 9 17l-5-5";
  else if (status === "failed") path = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v4M12 16h.01";
  else if (status === "expired" || status === "pending_approval")
    path = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2";
  else path = "M18 6 6 18M6 6l12 12";
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * The summary as a fallback for calls recorded without details: the stored
 * line repeats the title, which the card already shows.
 */
function summaryWithoutTitle(action: WidgetAction): string | null {
  if (!action.summary) return null;
  const prefix = `${action.title} — `;
  const rest = action.summary.startsWith(prefix) ? action.summary.slice(prefix.length) : "";
  return rest || (action.summary === action.title ? null : action.summary);
}

/** Citations shown as pills: pages and written answers. A tool's run is a step line instead. */
function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    if (c.kind === ACTION_CITATION_KIND) return false;
    if (seen.has(c.documentId)) return false;
    seen.add(c.documentId);
    return true;
  });
}

/**
 * What the model did before it answered, folded under one line (spec:
 * activity-disclosure): reasoning as quiet blocks, calls as step lines, in
 * the order they happened. Open while the model is at it, closed once the
 * answer starts, and the visitor's own toggle wins over both.
 */
function Activity({
  message: m,
  copy,
  onToggle,
}: {
  message: ChatMessage;
  copy: typeof DEFAULT_COPY;
  onToggle: (open: boolean) => void;
}) {
  const groups = activityGroups(m);
  const steps = groups.reduce((n, g) => n + (g.kind === "steps" ? g.actions.length : 0), 0);
  const busy = activityAutoOpen(m);
  const open = m.activityOpen ?? busy;
  const seconds = workedSeconds(m);
  const summary = busy
    ? `${copy.thinking}…`
    : [
        seconds === null ? "" : fill(copy.activityDone, { s: seconds }),
        steps > 0 ? fill(copy.activitySteps, { n: steps }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <details
      class="activity"
      part="activity"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary class="activity-summary" part="activity-summary">
        <span class="action-glyph activity-glyph">
          {busy ? (
            <i class="spin" aria-hidden="true" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          )}
        </span>
        <span class="activity-label">{summary}</span>
      </summary>
      <div class="activity-body">
        {groups.map((group, index) =>
          group.kind === "reasoning" ? (
            <div
              key={index}
              class="reasoning"
              part="reasoning"
              role="note"
              aria-label={copy.reasoning}
            >
              {group.text}
            </div>
          ) : (
            <div class="actions" part="actions" key={index}>
              {group.actions.map((a) => (
                <div key={a.id} class={`action ${a.status}`} part="action">
                  <span class="action-glyph">
                    <StepGlyph status={a.status} />
                  </span>
                  <span class="action-title" part="action-title">
                    {a.status === "running" ? `${a.title}…` : a.title}
                  </span>
                  <span
                    class={`action-status${statusIsQuiet(a.status) ? " sr-only" : ""}`}
                    part="action-status"
                    role="status"
                  >
                    {actionStatusCopy(a, copy)}
                  </span>
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </details>
  );
}

/**
 * Built-in launcher glyphs. `bell` is the bell from the brand mark; the others are opt-in via
 * the `launcher` option, and `launcherIconUrl` replaces all of them.
 * Attributes are written out rather than spread so the a11y lint can see them.
 */
function LauncherGlyph({ icon, iconUrl }: { icon: string; iconUrl: string }) {
  if (iconUrl) return <img src={iconUrl} alt="" />;
  if (icon === "chat") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (icon === "sparkle") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
      </svg>
    );
  }
  // The bell from the brand mark (a service bell in a speech bubble), drawn in
  // its 64-unit coordinates and fitted into the glyph box; the launcher button
  // is the bubble.
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <g transform="translate(12 12) scale(0.62) translate(-32 -27.9)">
        <rect x="28.6" y="15.8" width="6.8" height="2.7" rx="1.35" />
        <rect x="30.8" y="17.8" width="2.4" height="3.4" />
        <path d="M19.3 31.6C19.3 24.4 24.6 20.6 32 20.6s12.7 3.8 12.7 11z" />
        <rect x="18.1" y="31.4" width="27.8" height="2.1" rx="1.05" />
        <path
          d="M18.6 35.2h26.8l2.6 4.8H16z"
          stroke="currentColor"
          stroke-width="1.1"
          stroke-linejoin="round"
        />
      </g>
    </svg>
  );
}

export function Panel({
  config,
  cssVars,
  onControls,
  answerTransform,
  slots,
  host,
  getAuthToken,
}: PanelProps) {
  const { projectKey, apiUrl } = config;
  /**
   * Outbound analytics hook. Dispatched on the element, bubbling and composed,
   * so it reaches `window.addEventListener("deskbell:answer", ...)` (a tag
   * manager, no SDK) and `element.addEventListener` alike. Without an element
   * (tests) it goes straight to window.
   */
  const emit = (name: string, detail?: Record<string, unknown>) => {
    const event = new CustomEvent(`deskbell:${name}`, { detail, bubbles: true, composed: true });
    (host ?? window).dispatchEvent(event);
  };
  const locale = config.locale || navigator.language;
  const copy = { ...DEFAULT_COPY, ...config.copy };
  // Configured reasons (spec: widget-feedback-reasons) or the built-in three,
  // which keep their free-text field so existing deployments are unchanged.
  const configuredReasons = config.feedbackReasons.length > 0;
  const reasons: ReadonlyArray<{ value: string; label: string; note: number }> = configuredReasons
    ? config.feedbackReasons.map((r) => ({ value: r.id, label: r.label, note: r.note ?? 0 }))
    : [
        { value: "incorrect", label: copy.reasonIncorrect, note: 1000 },
        { value: "irrelevant", label: copy.reasonIrrelevant, note: 1000 },
        { value: "unaddressed", label: copy.reasonUnaddressed, note: 1000 },
      ];
  // Read-only preview (spec: conversation-preview): a transcript, nothing else.
  const readonly = config.readonly;
  // Inline mode (spec: widget-inline-mode): no launcher, always open, fills
  // its container; the header appears only when the host page slots one.
  const inline = config.mode === "inline" || readonly;
  const side = config.position === "bottom-left" ? "left" : "right";
  const draggable = config.launcherDraggable && !inline;
  // Thread sidebar (spec: widget-thread-sidebar) and its scope.
  const sidebar = config.historyLayout === "sidebar" && config.conversationHistory && !readonly;
  const scopeEntry = config.scopeKey ? config.context[config.scopeKey] : undefined;
  // How long a thread may sit silent before the next question starts a new one
  // (spec: sources-line-and-thread-status). 0 never rolls over.
  const idleMs = config.threadIdleMinutes * 60_000;
  const isStale = (lastActivity: number) => idleMs > 0 && Date.now() - lastActivity > idleMs;

  const [open, setOpen] = useState(inline || config.openOnLoad);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Downvote follow-up card — one open at a time, keyed by message index.
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reasonPick, setReasonPick] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  /** Message ids whose downvote reason was sent this session. */
  const [thanked, setThanked] = useState<ReadonlySet<string>>(new Set());
  // Free text: the picked reason's limit; with the built-in reasons, always offered.
  const noteMax = configuredReasons
    ? (reasons.find((r) => r.value === reasonPick)?.note ?? 0)
    : 1000;
  // Conversation continuity (spec: widget-conversation-history).
  const [view, setView] = useState<"thread" | "list">("thread");
  const [conversations, setConversations] = useState<WidgetConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(inline);
  const [scopeAll, setScopeAll] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Where a drag left the launcher; null until the visitor moves it (spec: widget-launcher-drag). */
  const [dragged, setDragged] = useState<{
    offsetX: number;
    offsetY: number;
    below: boolean;
  } | null>(null);
  const dragRef = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null);
  /** The host page's scheme when `colorSchemeSelector` finds one. */
  const [hostScheme, setHostScheme] = useState<"light" | "dark" | null>(null);
  const bootstrappedRef = useRef(false);
  const sessionRef = useRef<string>();
  /** When the active thread last moved; the idle timer measures from here. */
  const lastActivityRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One client per (server, project). The session is minted lazily, on the
  // first call that needs it, exactly as before the SDK carried the transport.
  const client = useMemo(
    () =>
      new DeskbellClient({
        baseUrl: apiUrl,
        projectKey,
        sessionId: () => (sessionRef.current ??= getSessionId()),
        getAuthToken,
      }),
    [apiUrl, projectKey, getAuthToken],
  );

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    // An inline widget is part of the page; grabbing focus on load would be rude.
    if (!inline) inputRef.current?.focus();
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      void bootstrap();
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Re-registered every render so the closures never go stale.
  useEffect(() => {
    onControls?.({
      open: (options) => {
        setOpen(true);
        const query = options?.query?.trim();
        if (!query) return;
        if (options?.submit) void ask(query);
        else {
          setInput(query);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
      },
      close: () => {
        if (!inline) setOpen(false);
      },
      toggle: () => setOpen((v) => inline || !v),
      ask: (question: string) => {
        setOpen(true);
        if (question.trim()) void ask(question.trim());
      },
    });
  });

  useEffect(() => {
    emit(open ? "opened" : "closed");
  }, [open]);

  // Inline mode can arrive after the first paint (a later attribute, a
  // configure() call, server config after a keyless first render); it is
  // always open, whenever it starts.
  useEffect(() => {
    if (inline) setOpen(true);
  }, [inline]);

  // Any element matching the selector opens the widget — the no-JS path to a
  // custom launcher that already exists somewhere in the host page's markup.
  useEffect(() => {
    const selector = config.triggerSelector;
    if (!selector) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.(selector)) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [config.triggerSelector]);

  // "mod+k" — mod is Cmd on Apple platforms, Ctrl elsewhere.
  useEffect(() => {
    const hotkey = config.hotkey;
    if (!hotkey) return;
    const parts = hotkey.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const wantsMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("cmd");
    const wantsShift = parts.includes("shift");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      if (wantsMod !== (e.metaKey || e.ctrlKey)) return;
      if (wantsShift !== e.shiftKey) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.hotkey]);

  // Delegated so a light-DOM <button slot="launcher"> toggles the panel with
  // no wiring from the host page. The default button carries no own handler,
  // so a click on it lands here exactly once. A click that ends a drag is not
  // a click.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const onClick = () => {
      if (dragRef.current?.moved) return;
      setOpen((v) => !v);
    };
    dock.addEventListener("click", onClick);
    return () => dock.removeEventListener("click", onClick);
  }, []);

  // Draggable launcher: pointer events on the dock, geometry in ./drag.ts.
  // The position is written into the two offset tokens the dock and panel
  // already read, so the panel follows for free. Nothing is persisted.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock || !draggable) return;
    const size = () => ({ w: dock.offsetWidth, h: dock.offsetHeight });
    const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
    const place = (pos: Point) => {
      const clamped = clampToViewport(pos, size(), viewport());
      setDragged(toDockOffsets(clamped, size(), viewport(), side));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = dock.getBoundingClientRect();
      dragRef.current = {
        start: { x: e.clientX, y: e.clientY },
        origin: { x: rect.left, y: rect.top },
        moved: false,
      };
      dock.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const now = { x: e.clientX, y: e.clientY };
      if (!d.moved && !isDrag(d.start, now)) return;
      d.moved = true;
      e.preventDefault();
      place({ x: d.origin.x + now.x - d.start.x, y: d.origin.y + now.y - d.start.y });
    };
    const onUp = (e: PointerEvent) => {
      if (dock.hasPointerCapture(e.pointerId)) dock.releasePointerCapture(e.pointerId);
      // Leave `moved` set through the click that follows pointerup, then clear.
      setTimeout(() => {
        dragRef.current = null;
      }, 0);
    };
    const onResize = () => {
      const rect = dock.getBoundingClientRect();
      place({ x: rect.left, y: rect.top });
    };
    dock.addEventListener("pointerdown", onDown);
    dock.addEventListener("pointermove", onMove);
    dock.addEventListener("pointerup", onUp);
    dock.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      dock.removeEventListener("pointerdown", onDown);
      dock.removeEventListener("pointermove", onMove);
      dock.removeEventListener("pointerup", onUp);
      dock.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, [draggable, side]);

  // Follow the host page's theme toggle (spec: widget-events-lifecycle).
  useEffect(() => {
    const selector = config.colorSchemeSelector;
    if (!selector) {
      setHostScheme(null);
      return;
    }
    let target: Element | null = null;
    try {
      target = document.querySelector(selector);
    } catch {
      // an invalid selector is a config typo, not a reason to break
    }
    if (!target) {
      setHostScheme(null);
      return;
    }
    const el = target;
    const apply = () => setHostScheme(readScheme(el));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(el, { attributes: true, attributeFilter: SCHEME_ATTRIBUTES });
    return () => observer.disconnect();
  }, [config.colorSchemeSelector]);

  // Programmatic open — first brick of the widget JS API (spec: widget-js-api).
  // The host page dispatches `window.dispatchEvent(new Event("deskbell:open"))`.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("deskbell:open", onOpen);
    return () => window.removeEventListener("deskbell:open", onOpen);
  }, []);

  // Install beacon (spec: single-tag-embed-deploy-onboarding): one fire-and-forget
  // ping per tab session lets the dashboard verify the embed by origin. Errors are
  // swallowed — install telemetry must never surface to the visitor.
  useEffect(() => {
    try {
      const key = `deskbell-pinged:${projectKey}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked (private mode) — ping every load
    }
    void client.ping().catch(() => {});
  }, []);

  const updateAt = (index: number, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? fn(m) : m)));
  };
  const updateLast = (fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));
  };

  /**
   * Record a call's state on the message it belongs to: the one already
   * holding it — a confirmed call stays where its card was, as the server
   * stores it — else the message being written.
   */
  const recordAction = (action: WidgetAction) => {
    setMessages((prev) => {
      const at = prev.findIndex((m) => m.actions?.some((a) => a.id === action.id));
      const target = at === -1 ? prev.length - 1 : at;
      return prev.map((m, i) => {
        if (i !== target) return m;
        const rest = (m.actions ?? []).filter((a) => a.id !== action.id);
        return { ...m, actions: [...rest, action], trail: withStep(m.trail, action.id) };
      });
    });
  };

  const loadThreads = async (): Promise<WidgetConversation[]> => {
    setThreadsLoading(true);
    setThreadsError(false);
    try {
      const list = await client.conversations.list(
        scopeEntry && !scopeAll
          ? { scope: { key: config.scopeKey, id: scopeEntry.id }, limit: 50 }
          : sidebar
            ? { limit: 50 }
            : {},
      );
      setConversations(list);
      return list;
    } catch {
      setConversations([]);
      setThreadsError(true);
      return [];
    } finally {
      setThreadsLoading(false);
    }
  };

  const openList = async () => {
    if (!config.conversationHistory) return;
    abortRef.current?.abort();
    setView("list");
    setHistoryLoading(true);
    await loadThreads();
    setHistoryLoading(false);
  };

  // Deleting is optimistic: the row goes, the thread on screen resets if it
  // was the one, and only a failure other than "already gone" puts it back.
  const deleteThread = async (id: string) => {
    setConfirmDelete(null);
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) startNew();
    try {
      await client.conversations.delete(id);
      emit("conversation", { id, action: "deleted" });
    } catch (error) {
      if (!(error instanceof DeskbellError && error.status === 404)) setConversations(previous);
    }
  };

  const openConversation = async (id: string) => {
    setView("thread");
    setHistoryLoading(true);
    setMessages([]);
    setReasonFor(null);
    try {
      const history = await client.conversations.messages(id);
      setActiveConvId(id);
      storeConv(projectKey, id);
      // The visitor chose this thread, however old: the idle timer starts now.
      lastActivityRef.current = Date.now();
      setMessages(history.map((m) => toChat(m, copy.refusal)));
      emit("conversation", { id, action: "opened" });
    } catch {
      // purged or foreign id — forget it and start clean
      setActiveConvId(null);
      storeConv(projectKey, null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const startNew = () => {
    setActiveConvId(null);
    storeConv(projectKey, null);
    setMessages([]);
    setReasonFor(null);
    setView("thread");
    setTimeout(() => inputRef.current?.focus(), 0);
    emit("conversation", { id: null, action: "reset" });
  };

  /** Open one thread on screen unless it has gone stale; false when nothing was shown. */
  const resume = async (id: string, force = false): Promise<boolean> => {
    const history = await client.conversations.messages(id);
    const at = newestAt(history);
    if (!force && isStale(at)) return false;
    setActiveConvId(id);
    lastActivityRef.current = at;
    setMessages(history.map((m) => toChat(m, copy.refusal)));
    return true;
  };

  // A staff member's view of someone else's thread (spec: conversation-preview).
  const loadPreview = async (id: string) => {
    setHistoryLoading(true);
    try {
      const preview = await client.conversations.preview(id);
      setActiveConvId(id);
      setMessages(preview.messages.map((m) => toChat(m, copy.refusal)));
      emit("preview", {
        conversationId: id,
        title: preview.conversation.title,
        owner: preview.endUser,
        context: preview.conversation.context,
      });
    } catch (error) {
      const forbidden =
        error instanceof DeskbellError && (error.status === 401 || error.status === 403);
      setMessages([
        { role: "assistant", text: forbidden ? copy.previewForbidden : copy.error, refused: true },
      ]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // First open: what to show depends on `resumeThread` — the thread this
  // browser last had open, the visitor's newest one, or a blank composer.
  const bootstrap = async () => {
    sessionRef.current ??= getSessionId();
    if (config.conversationId) {
      // A page that names the thread gets that thread, stale or not.
      if (readonly) return loadPreview(config.conversationId);
      setHistoryLoading(true);
      try {
        await resume(config.conversationId, true);
      } catch {
        setMessages([{ role: "assistant", text: copy.error, refused: true }]);
      } finally {
        setHistoryLoading(false);
      }
      return;
    }
    if (readonly || !config.conversationHistory) return;
    const listPromise = sidebar ? loadThreads() : null;
    if (config.resumeThread === "none") return;
    setHistoryLoading(true);
    try {
      if (config.resumeThread === "newest") {
        const list = listPromise ? await listPromise : await loadThreads();
        const newest = list[0];
        if (newest && !(await resume(newest.id))) storeConv(projectKey, null);
      } else {
        const stored = getStoredConv(projectKey);
        // Silent too long: the next question starts fresh. Recent list keeps it.
        if (stored && !(await resume(stored))) storeConv(projectKey, null);
      }
    } catch {
      storeConv(projectKey, null);
      setHistoryLoading(false);
      if (!sidebar) await openList();
      return;
    }
    setHistoryLoading(false);
  };

  // Switching the scope tab re-reads the list, and so does a new client: a
  // host that hands over the visitor's token after the first paint (a React
  // prop, a late script) changes who owns the threads, and the anonymous
  // session's list must not stand in for theirs (spec: end-user-identity).
  useEffect(() => {
    if (sidebar && open) void loadThreads();
  }, [scopeAll, client]);

  /**
   * One turn: a question, or the visitor's answer to a confirmation card
   * (spec: mcp-actions). An approval continues the thread it paused in and
   * gets an answer bubble of its own; the card stays on the message it
   * belongs to, showing what was decided.
   */
  const run = async (
    turn: { question: string } | { approval: { callId: string; approved: boolean } },
  ) => {
    if (readonly) return;
    sessionRef.current ??= getSessionId();
    const question = "question" in turn ? turn.question : "";
    const approval = "approval" in turn ? turn.approval : undefined;
    // A panel left open across a long silence rolls over too, not only a
    // reopen: the question is about something new, so it gets a new thread.
    let convId = activeConvId;
    if (!approval && convId && isStale(lastActivityRef.current)) {
      convId = null;
      setActiveConvId(null);
      storeConv(projectKey, null);
      setMessages([]);
      setReasonFor(null);
    }
    if (approval) {
      if (!convId) return;
      emit("confirm", { id: approval.callId, approved: approval.approved, conversationId: convId });
    } else {
      emit("question", { question, conversationId: convId });
    }
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((prev) => [
      ...prev.map((m) =>
        approval && m.actions?.some((a) => a.id === approval.callId)
          ? {
              ...m,
              actions: m.actions.map((a) =>
                a.id === approval.callId
                  ? {
                      ...a,
                      status: approval.approved ? ("approved" as const) : ("denied" as const),
                    }
                  : a,
              ),
            }
          : m,
      ),
      ...(approval ? [] : [{ role: "user" as const, text: question }]),
      { role: "assistant", text: "", pending: true, startedAt: Date.now() },
    ]);
    let answerText = "";
    let answerCitations: Citation[] = [];
    let unsupportedTerms: string[] = [];
    let clarified = false;
    const context = Object.keys(config.context).length > 0 ? config.context : undefined;
    const consume = async () => {
      answerText = "";
      answerCitations = [];
      clarified = false;
      const stream = client.ask(
        { message: question, conversationId: convId ?? undefined, locale, context, approval },
        { signal: controller.signal },
      );
      for await (const event of stream) {
        if (event.type === "token") {
          answerText += event.value;
          updateLast((m) => settle({ ...m, pending: false, text: m.text + event.value }));
        } else if (event.type === "reasoning") {
          updateLast((m) => ({ ...m, trail: withReasoning(m.trail, event.value) }));
        } else if (event.type === "action") {
          recordAction({ id: event.id, title: event.title, status: event.status });
          emit("action", { id: event.id, title: event.title, status: event.status });
        } else if (event.type === "confirm") {
          updateLast((m) => ({
            ...settle(m),
            pending: false,
            trail: withStep(m.trail, event.id),
            actions: [
              ...(m.actions ?? []).filter((a) => a.id !== event.id),
              {
                id: event.id,
                title: event.title,
                status: "pending_approval" as const,
                summary: event.summary,
                details: event.details,
                expiresAt: event.expiresAt,
              },
            ],
          }));
          emit("confirm", {
            id: event.id,
            title: event.title,
            summary: event.summary,
            details: event.details,
          });
        } else if (event.type === "citations") {
          answerCitations = event.citations;
          updateLast((m) => ({ ...m, citations: event.citations }));
        } else if (event.type === "verification") {
          unsupportedTerms = event.unsupportedTerms;
          updateLast((m) => ({ ...m, unsupportedTerms: event.unsupportedTerms }));
        } else if (event.type === "refusal") {
          // A refusal carrying text is the project's own reply, spoken as an
          // answer; without one the visitor reads the refusal copy.
          const spoken = event.text;
          updateLast((m) =>
            settle(
              spoken
                ? { ...m, pending: false, text: spoken }
                : { ...m, pending: false, refused: true, text: copy.refusal },
            ),
          );
          emit("refusal", { question, reason: event.reason });
        } else if (event.type === "clarify") {
          clarified = true;
          const clarify = { question: event.question, options: event.options };
          updateLast((m) => settle({ ...m, pending: false, text: event.question, clarify }));
          emit("clarify", { question, asked: event.question, options: event.options });
        } else if (event.type === "done") {
          // The stream is over, whatever it carried. An answer with no text
          // at all — every step went to a tool and nothing was written —
          // would otherwise keep its typing indicator for good.
          updateLast((m) =>
            settle({
              ...m,
              pending: false,
              ...(event.messageId ? { id: event.messageId } : {}),
            }),
          );
          if (event.conversationId) {
            setActiveConvId(event.conversationId);
            storeConv(projectKey, event.conversationId);
            if (!convId) emit("conversation", { id: event.conversationId, action: "created" });
          }
          lastActivityRef.current = Date.now();
          // A clarification is not an answer; the host heard deskbell:clarify.
          if (!clarified) {
            emit("answer", {
              question,
              conversationId: event.conversationId,
              messageId: event.messageId,
              answer: answerText,
              citations: answerCitations,
              ...(unsupportedTerms.length > 0 ? { unsupportedTerms } : {}),
            });
          }
          if (sidebar) void loadThreads();
          break;
        }
      }
    };
    try {
      try {
        await consume();
      } catch (error) {
        // A token that expired mid-session gets one retry with a fresh one
        // (spec: end-user-identity); the client asks the host for it again.
        if (error instanceof DeskbellError && error.status === 401 && getAuthToken) await consume();
        else throw error;
      }
    } catch (error) {
      if (error instanceof DeskbellError && error.status === 401) {
        updateLast((m) => ({ ...m, pending: false, refused: true, text: copy.unauthorized }));
        emit("unauthorized", { question });
      } else if (error instanceof DeskbellError && error.status === 429) {
        // Rate limited or over the site's daily budget (spec: widget-abuse-protection).
        // A distinct message, not the generic error: "try again in a moment" is
        // true and actionable, "something went wrong" is neither.
        updateLast((m) => ({ ...m, pending: false, refused: true, text: copy.limited }));
        emit("limited", { question, retryAfter: error.retryAfter ?? 0 });
      } else if ((error as Error).name !== "AbortError") {
        updateLast((m) => ({ ...m, pending: false, refused: true, text: copy.error }));
        emit("error", { question, status: error instanceof DeskbellError ? error.status : null });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const ask = (question: string) => run({ question });

  const postFeedback = (
    messageId: string,
    feedback: "up" | "down" | null,
    reason: string | null = null,
    comment: string | null = null,
  ) => client.feedback({ messageId, feedback, reason, comment });

  // Upsert semantics (spec: widget-feedback): tapping the active thumb clears
  // the vote. Optimistic — a failed POST rolls back silently. A downvote opens
  // the reason card; the reason lands in a second upsert.
  const sendVote = async (index: number, value: "up" | "down") => {
    const message = messages[index];
    if (!message?.id || !sessionRef.current) return;
    const previous = message.feedback ?? null;
    const next = previous === value ? null : value;
    updateAt(index, (m) => ({ ...m, feedback: next }));
    if (next === "down") {
      setReasonFor(index);
      setReasonPick(null);
      setReasonText("");
    } else if (reasonFor === index) {
      setReasonFor(null);
    }
    emit("feedback", { messageId: message.id, feedback: next });
    try {
      await postFeedback(message.id, next);
    } catch {
      updateAt(index, (m) => ({ ...m, feedback: previous }));
      setReasonFor((v) => (v === index ? null : v));
    }
  };

  const sendReason = async (index: number) => {
    const message = messages[index];
    setReasonFor(null);
    if (!message?.id) return;
    const id = message.id;
    try {
      await postFeedback(id, "down", reasonPick, reasonText.trim() || null);
      setThanked((prev) => new Set(prev).add(id));
    } catch {
      // the vote itself is already stored; losing the reason is acceptable
    }
  };

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    void ask(question);
  };

  // Escape closes; Tab cycles inside the dialog (minimal focus trap).
  const onPanelKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (!inline) setOpen(false);
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled])",
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      class={`root${inline ? " inline" : ""}${dragged?.below ? " below" : ""}`}
      data-scheme={hostScheme ?? config.colorScheme}
    >
      <style>{CSS}</style>
      {/* Resolved config sits between the palette default and the host page. */}
      <style>{`.root{${cssVars}}`}</style>
      {/* A dragged launcher overrides the configured offsets; host CSS still wins. */}
      {dragged ? (
        <style>{`.root{--_cfg-launcher-offset-x:${dragged.offsetX}px;--_cfg-launcher-offset-y:${dragged.offsetY}px}`}</style>
      ) : null}
      {config.launcher === "none" || inline ? null : (
        // Click is delegated here so a slotted custom launcher works with no
        // wiring; the default child button keeps the semantics and keyboard.
        <div
          class={`dock ${side}${draggable ? " draggable" : ""}`}
          part="launcher-container"
          ref={dockRef}
        >
          <slot name="launcher">
            <button
              type="button"
              class={`launcher${config.launcherLabel && !open ? " labelled" : ""}`}
              part="launcher"
              aria-label={open ? "Close help" : "Open help"}
              aria-expanded={open}
            >
              <span class="launcher-ico" part="launcher-icon">
                {open ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                ) : (
                  <LauncherGlyph icon={config.launcher} iconUrl={config.launcherIconUrl} />
                )}
              </span>
              {config.launcherLabel && !open ? (
                <span part="launcher-label">{config.launcherLabel}</span>
              ) : null}
            </button>
          </slot>
        </div>
      )}
      {open ? (
        <div
          class={`panel ${side}${inline ? " inline" : ""}`}
          part="panel"
          role="dialog"
          aria-label="Help"
          ref={panelRef}
          onKeyDown={onPanelKeyDown}
        >
          {inline && !slots?.has("header") ? null : (
            <div class="head" part="header">
              <slot name="header">
                <div class="head-left">
                  {view === "thread" && config.conversationHistory && !sidebar ? (
                    <button
                      type="button"
                      class="head-back"
                      part="back-button"
                      aria-label={copy.recent}
                      onClick={() => void openList()}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                  ) : null}
                  <div class="head-text">
                    <span class="head-title" part="header-title">
                      {view === "list" ? copy.recent : copy.title}
                    </span>
                    {view === "thread" ? (
                      <span class="head-sub" part="header-subtitle">
                        {copy.subtitle}
                      </span>
                    ) : null}
                  </div>
                </div>
              </slot>
              <span class="head-actions" part="header-actions">
                <slot name="header-actions" />
              </span>
              {inline ? null : (
                <button
                  type="button"
                  class="close"
                  part="close-button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div class="columns">
            {sidebar ? (
              <Sidebar
                conversations={conversations}
                activeId={activeConvId}
                loading={threadsLoading}
                error={threadsError}
                collapsed={!sidebarOpen}
                confirmId={confirmDelete}
                scope={scopeEntry ? { all: scopeAll, onChange: setScopeAll } : null}
                copy={copy}
                onToggle={() => setSidebarOpen((v) => !v)}
                onOpen={(id) => void openConversation(id)}
                onNew={startNew}
                onConfirm={setConfirmDelete}
                onDelete={(id) => void deleteThread(id)}
                onRetry={() => void loadThreads()}
              />
            ) : null}
            <div class="main">
              {view === "list" && !sidebar ? (
                <>
                  <div class="list" part="list">
                    {historyLoading ? (
                      <div class="empty">
                        <span class="typing" role="status" aria-label="Loading">
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    ) : conversations.length === 0 ? (
                      <div class="empty">{copy.noRecent}</div>
                    ) : (
                      conversations.map((c) => (
                        <button
                          type="button"
                          class="convo"
                          part="conversation"
                          key={c.id}
                          onClick={() => void openConversation(c.id)}
                        >
                          <span class="convo-main">
                            <span class="convo-title">{c.title}</span>
                            <span class="convo-snippet">{c.snippet}</span>
                          </span>
                          <span class="convo-time">{timeAgo(c.lastMessageAt)}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div class="list-footer">
                    <button
                      type="button"
                      class="new-btn"
                      part="new-question-button"
                      onClick={startNew}
                    >
                      {copy.newQuestion}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div class="list" part="list" ref={listRef}>
                    {historyLoading && messages.length === 0 ? (
                      <div class="empty">
                        <span class="typing" role="status" aria-label="Loading">
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    ) : messages.length === 0 && !readonly ? (
                      <div class="empty" part="empty-state">
                        <slot name="empty-state">
                          {copy.welcomeTitle ? (
                            <span class="welcome-title" part="welcome-title">
                              {copy.welcomeTitle}
                            </span>
                          ) : null}
                          <span class="empty-text">{copy.empty}</span>
                          {config.promptGroups.length > 0 ? (
                            <div class="welcome" part="welcome">
                              {config.promptGroups.map((group) => (
                                <div class="card" part="welcome-card" key={group.title}>
                                  {group.icon ? (
                                    <img
                                      class="card-icon"
                                      part="welcome-card-icon"
                                      src={group.icon}
                                      alt=""
                                    />
                                  ) : null}
                                  <span class="card-title" part="welcome-card-title">
                                    {group.title}
                                  </span>
                                  {group.description ? (
                                    <span class="card-desc" part="welcome-card-description">
                                      {group.description}
                                    </span>
                                  ) : null}
                                  <div class="card-prompts">
                                    {group.prompts.map((prompt) => (
                                      <button
                                        type="button"
                                        key={prompt}
                                        class="prompt"
                                        part="welcome-prompt"
                                        onClick={() => void ask(prompt)}
                                      >
                                        {prompt}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : config.suggestedQuestions.length > 0 ? (
                            <div class="suggestions">
                              {config.suggestedQuestions.map((q) => (
                                <button
                                  type="button"
                                  key={q}
                                  class="suggestion"
                                  part="suggestion"
                                  onClick={() => void ask(q)}
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </slot>
                      </div>
                    ) : null}
                    {messages.map((m, i) => (
                      <div
                        key={i}
                        class={`msg ${m.role}${m.refused ? " refused" : ""}`}
                        part="message"
                      >
                        {activityGroups(m).length > 0 ? (
                          <Activity
                            message={m}
                            copy={copy}
                            onToggle={(open) =>
                              updateAt(i, (cur) => ({
                                ...cur,
                                activityOpen: open === activityAutoOpen(cur) ? undefined : open,
                              }))
                            }
                          />
                        ) : null}
                        {showBubble(m) ? (
                          <div
                            class={`bubble${m.role === "assistant" && !m.refused ? " md" : ""}`}
                            part="bubble"
                          >
                            {m.pending && !m.text ? (
                              <span
                                class="typing"
                                part="typing"
                                role="status"
                                aria-label={copy.thinking}
                              >
                                <i />
                                <i />
                                <i />
                              </span>
                            ) : m.role === "assistant" && !m.refused ? (
                              // Only model output is Markdown. Refusals and errors are
                              // operator copy and the visitor's messages are theirs.
                              <Markdown
                                source={answerTransform ? answerTransform(m.text) : m.text}
                                onLink={(href) => emit("link", { href })}
                              />
                            ) : (
                              m.text
                            )}
                            {m.role === "assistant" && !m.refused && m.unsupportedTerms?.length ? (
                              <Hedge template={copy.unsupportedNote} terms={m.unsupportedTerms} />
                            ) : null}
                          </div>
                        ) : null}
                        {m.citations && !m.refused && uniqueCitations(m.citations).length > 0 ? (
                          <div class="citations" part="citations">
                            <span class="citations-label">{copy.sources}</span>
                            <div class="pills">
                              {uniqueCitations(m.citations).map((c) =>
                                c.url ? (
                                  <a
                                    key={c.documentId}
                                    class={pillClass(c)}
                                    part={citationParts(c.kind)}
                                    data-kind={c.kind}
                                    href={c.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() =>
                                      emit("citation", {
                                        href: c.url,
                                        documentId: c.documentId,
                                        title: c.title,
                                      })
                                    }
                                  >
                                    <PillBody citation={c} label={copy.writtenAnswer} />
                                  </a>
                                ) : (
                                  <span
                                    key={c.documentId}
                                    class={pillClass(c)}
                                    part={citationParts(c.kind)}
                                    data-kind={c.kind}
                                  >
                                    <PillBody citation={c} label={copy.writtenAnswer} />
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                        {m.clarify && i === messages.length - 1 && !readonly ? (
                          <div class="clarify-options" part="clarify-options">
                            {m.clarify.options.map((option) => (
                              <button
                                type="button"
                                key={option}
                                class="suggestion clarify-option"
                                part="clarify-option"
                                disabled={busy}
                                onClick={() => void ask(option)}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {m.actions?.filter(isOpenCard).map((a) => (
                          <div key={a.id} class="action-card" part="action-card">
                            <span class="action-card-eyebrow">{copy.actionConfirmTitle}</span>
                            <span class="action-title" part="action-title">
                              {a.title}
                            </span>
                            {a.details && a.details.length > 0 ? (
                              <dl class="action-details" part="action-details">
                                {a.details.map((d) => (
                                  <div key={d.label} class="action-detail">
                                    <dt>{d.label}</dt>
                                    <dd>{d.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : summaryWithoutTitle(a) ? (
                              <p class="action-summary">{summaryWithoutTitle(a)}</p>
                            ) : null}
                            {!readonly ? (
                              <div class="action-buttons" part="action-buttons">
                                <button
                                  type="button"
                                  class="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void run({ approval: { callId: a.id, approved: false } })
                                  }
                                >
                                  {copy.actionDeny}
                                </button>
                                <button
                                  type="button"
                                  class="primary"
                                  disabled={busy}
                                  onClick={() =>
                                    void run({ approval: { callId: a.id, approved: true } })
                                  }
                                >
                                  {copy.actionConfirm}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {m.role === "assistant" &&
                        m.id &&
                        !m.pending &&
                        m.text &&
                        config.feedback ? (
                          <div class="feedback" part="feedback">
                            <button
                              type="button"
                              class={`fb${m.feedback === "up" ? " on" : ""}`}
                              part="feedback-button"
                              aria-label={copy.goodAnswer}
                              aria-pressed={m.feedback === "up"}
                              disabled={readonly}
                              onClick={() => void sendVote(i, "up")}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M7 10v12" />
                                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              class={`fb${m.feedback === "down" ? " on" : ""}`}
                              part="feedback-button"
                              aria-label={copy.badAnswer}
                              aria-pressed={m.feedback === "down"}
                              disabled={readonly}
                              onClick={() => void sendVote(i, "down")}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M17 14V2" />
                                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                              </svg>
                            </button>
                            {m.feedback === "down" &&
                            (m.feedbackReason || (m.id && thanked.has(m.id))) ? (
                              <span class="fb-thanks" part="feedback-thanks">
                                {copy.feedbackThanks}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {reasonFor === i ? (
                          <div class="reason">
                            <span class="reason-title">{copy.whatWrong}</span>
                            <div class="chips">
                              {reasons.map((r) => (
                                <button
                                  type="button"
                                  key={r.value}
                                  class={`chip${reasonPick === r.value ? " on" : ""}`}
                                  aria-pressed={reasonPick === r.value}
                                  onClick={() =>
                                    setReasonPick((v) => (v === r.value ? null : r.value))
                                  }
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                            {noteMax > 0 ? (
                              <input
                                value={reasonText}
                                onInput={(e) =>
                                  setReasonText(
                                    (e.target as HTMLInputElement).value.slice(0, noteMax),
                                  )
                                }
                                placeholder={copy.reasonPlaceholder}
                                aria-label={copy.reasonPlaceholder}
                                maxLength={noteMax}
                              />
                            ) : null}
                            {configuredReasons && noteMax > 0 ? (
                              <span class="reason-count">
                                {reasonText.length}/{noteMax}
                              </span>
                            ) : null}
                            {copy.feedbackNote ? (
                              <div class="reason-note" part="feedback-note">
                                <Markdown
                                  source={copy.feedbackNote}
                                  onLink={(href) => emit("link", { href })}
                                />
                              </div>
                            ) : null}
                            <div class="reason-actions">
                              <button
                                type="button"
                                class="ghost"
                                onClick={() => setReasonFor(null)}
                              >
                                {copy.reasonSkip}
                              </button>
                              <button
                                type="button"
                                class="primary"
                                disabled={
                                  configuredReasons
                                    ? !reasonPick
                                    : !reasonPick && !reasonText.trim()
                                }
                                onClick={() => void sendReason(i)}
                              >
                                {copy.reasonSend}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {readonly ? null : (
                    <form class="composer" part="composer" onSubmit={onSubmit}>
                      <input
                        ref={inputRef}
                        value={input}
                        onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                        part="composer-input"
                        placeholder={copy.placeholder}
                        aria-label={copy.placeholder}
                        maxLength={4000}
                      />
                      <button
                        type="submit"
                        class="send"
                        part="send-button"
                        aria-label={copy.send}
                        disabled={busy || input.trim().length === 0}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                          <path d="m21.854 2.147-10.94 10.939" />
                        </svg>
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
          {config.disclaimer ? (
            <div class="disclaimer" part="disclaimer">
              <Markdown source={config.disclaimer} onLink={(href) => emit("link", { href })} />
            </div>
          ) : null}
          <slot name="footer">
            {config.poweredBy ? (
              <div class="footer" part="powered-by">
                <a href="https://deskbell.dev" target="_blank" rel="noreferrer">
                  {copy.poweredBy}
                </a>
              </div>
            ) : null}
          </slot>
        </div>
      ) : null}
    </div>
  );
}
