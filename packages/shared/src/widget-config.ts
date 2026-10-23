/**
 * The widget's public configuration surface — the single source of truth.
 *
 * Everything derives from `WIDGET_OPTIONS`: the zod schema for server-side
 * validation (../index.ts), the widget's attribute parsing, the dashboard's
 * form controls, and the generated docs table. Adding an option means editing
 * this file and nothing else.
 *
 * This module is deliberately dependency-free — no zod, no preact, no imports
 * at all — because `@deskbell/widget` loads it at RUNTIME and every KB
 * ships on customers' pages (AGENTS rule 5). Human-facing labels and help text
 * live in ./widget-config-meta.ts so they never enter the widget bundle.
 */

export type ColorScheme = "light" | "dark" | "auto";
export type LauncherIcon = "bell" | "chat" | "sparkle" | "none";
export type WidgetPosition = "bottom-right" | "bottom-left";
/** `floating`: launcher + popover. `inline`: fills its container, always open. */
export type WidgetMode = "floating" | "inline";

/** A card in the empty state: a topic with a few prompts that start a thread. */
export interface PromptGroup {
  title: string;
  description?: string;
  /** Square image, http(s) or a data: URL. */
  icon?: string;
  prompts: string[];
}

/**
 * One downvote reason. `note` is the maximum length of the free-text field
 * offered with it; absent or 0 means no field for that reason.
 */
export interface FeedbackReasonOption {
  id: string;
  label: string;
  note?: number;
}

export type HistoryLayout = "stack" | "sidebar";
export type ResumeThread = "last" | "newest" | "none";

/** Where on the host page a conversation starts: opaque key/value, ≤8 keys. */
export type WidgetContext = Record<string, { id: string; name?: string }>;

export const CONTEXT_LIMITS = { keys: 8, key: 64, id: 128, name: 200 } as const;
const CONTEXT_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/i;

/** Shape of a feedback reason id on the wire; the server enforces the same rule. */
export const REASON_ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export const PROMPT_GROUP_LIMITS = {
  groups: 8,
  prompts: 6,
  title: 80,
  description: 200,
  prompt: 200,
  icon: 2048,
} as const;
export const FEEDBACK_REASON_LIMITS = { reasons: 8, label: 80, note: 2000 } as const;

/**
 * What the assistant says under an answer that named things the
 * documentation does not contain (spec: answer-verification). The default
 * for the `unsupportedNote` copy key; `{terms}` is replaced by the names.
 */
export const UNSUPPORTED_NOTE_DEFAULT =
  "I couldn't find {terms} in the documentation, so that part may not be accurate.";

/**
 * The note with the names filled in: "A", "A and B", "A, B and C". `wrap`
 * decorates each name — bold in the widget, nothing in a stored turn.
 */
export function unsupportedNote(
  template: string,
  terms: string[],
  wrap: (term: string) => string = (t) => t,
): string {
  const names = terms.map(wrap);
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return template.replace("{terms}", list);
}

/**
 * Overridable UI strings. The runtime list is the source of truth; the type
 * derives from it, so the coercion allowlist and `WidgetCopy` can never drift.
 */
export const COPY_KEYS = [
  "title",
  "subtitle",
  "placeholder",
  "send",
  "empty",
  "refusal",
  "error",
  "limited",
  "sources",
  "goodAnswer",
  "badAnswer",
  "whatWrong",
  "reasonIncorrect",
  "reasonIrrelevant",
  "reasonUnaddressed",
  "reasonPlaceholder",
  "reasonSend",
  "reasonSkip",
  "recent",
  "noRecent",
  "newQuestion",
  "poweredBy",
  "welcomeTitle",
  "feedbackNote",
  "unsupportedNote",
  "feedbackThanks",
  "thinking",
  "unauthorized",
  "threads",
  "showThreads",
  "hideThreads",
  "newChat",
  "deleteThread",
  "confirmDelete",
  "cancel",
  "threadsError",
  "retry",
  "scopeThis",
  "scopeAll",
  "previewForbidden",
  "writtenAnswer",
  "actionRunning",
  "actionDone",
  "actionFailed",
  "actionConfirmTitle",
  "actionConfirm",
  "actionDeny",
  "actionApproved",
  "actionDenied",
  "actionExpired",
  "activityDone",
  "activitySteps",
  "activityStep",
  "feedbackPrompt",
  "reasoning",
] as const;

export type WidgetCopy = Record<(typeof COPY_KEYS)[number], string>;

export interface WidgetConfig {
  projectKey: string;
  apiUrl: string;
  locale: string;
  colorScheme: ColorScheme;
  accent: string;
  radius: string;
  font: string;
  theme: Partial<Record<TokenName, string>>;
  launcher: LauncherIcon;
  launcherIconUrl: string;
  launcherLabel: string;
  position: WidgetPosition;
  offsetX: number;
  offsetY: number;
  openOnLoad: boolean;
  triggerSelector: string;
  hotkey: string;
  suggestedQuestions: string[];
  conversationHistory: boolean;
  feedback: boolean;
  copy: Partial<WidgetCopy>;
  poweredBy: boolean;
  mode: WidgetMode;
  /** Inline Markdown shown above the footer, e.g. an AI notice with a policy link. */
  disclaimer: string;
  launcherDraggable: boolean;
  /** Selector of the host element whose class or data-theme says light or dark. */
  colorSchemeSelector: string;
  promptGroups: PromptGroup[];
  feedbackReasons: FeedbackReasonOption[];
  context: WidgetContext;
  /** A key of `context` the thread list can be scoped to. */
  scopeKey: string;
  historyLayout: HistoryLayout;
  resumeThread: ResumeThread;
  /** Minutes of silence after which the next question starts a new thread; 0 never. */
  threadIdleMinutes: number;
  /** Show one conversation without a composer (spec: conversation-preview). */
  readonly: boolean;
  /** The conversation to open; with `readonly`, through the staff preview endpoint. */
  conversationId: string;
}

export type WidgetOptionKey = keyof WidgetConfig;

/**
 * Options an admin may set server-side. `projectKey`/`apiUrl` identify the
 * deployment and `poweredBy` is decided by the server itself, so none of the
 * three are accepted from stored appearance config.
 */
export type WidgetAppearance = Omit<WidgetConfig, "projectKey" | "apiUrl" | "poweredBy">;

export type OptionKind =
  | "string"
  | "css" // a CSS value: colour, length, font stack — sanitised before interpolation
  | "int"
  | "boolean"
  | "enum"
  | "stringList"
  | "theme"
  | "copy"
  | "promptGroups"
  | "reasons"
  | "context";

export interface WidgetOption {
  key: WidgetOptionKey;
  /** kebab-case attribute on <deskbell-widget>. */
  attr: string;
  kind: OptionKind;
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /** Upper bound: item count for `stringList`, value for `int`. */
  max?: number;
  /** True for options the server must never override (identity + branding). */
  clientOnly?: boolean;
}

/**
 * CSS custom properties the widget exposes, without the `--deskbell-` prefix.
 * Also the allowlist for the `theme` option. Palette defaults live in the
 * widget's stylesheet (light/dark/auto), not here.
 */
export const TOKENS = [
  "surface",
  "surface-subtle",
  "surface-hover",
  "surface-active",
  "text",
  "text-secondary",
  "text-muted",
  "text-subtle",
  "border",
  "border-strong",
  "accent",
  "accent-contrast",
  "accent-subtle",
  "header-bg",
  "header-text",
  "bubble-user-bg",
  "bubble-user-fg",
  "bubble-assistant-bg",
  "bubble-assistant-fg",
  "bubble-radius",
  "launcher-bg",
  "launcher-fg",
  "launcher-size",
  "launcher-offset-x",
  "launcher-offset-y",
  "radius",
  "panel-width",
  "panel-height",
  "shadow",
  "z",
  "font",
  "font-size",
  "control-radius",
  "input-radius",
  "focus-ring",
  "code-bg",
  "code-fg",
] as const;

export type TokenName = (typeof TOKENS)[number];

/** Structural elements exposed to the host page via ::part(). */
export const PARTS = [
  "launcher-container",
  "launcher",
  "launcher-icon",
  "launcher-label",
  "panel",
  "header",
  "header-title",
  "header-subtitle",
  "back-button",
  "close-button",
  "list",
  "empty-state",
  "suggestion",
  "message",
  "bubble",
  "citations",
  "hedge",
  "citation-pill",
  "citation-label",
  "feedback",
  "feedback-button",
  "conversation",
  "new-question-button",
  "composer",
  "composer-input",
  "send-button",
  "powered-by",
  "md-heading",
  "md-list",
  "md-code",
  "md-table",
  "sidebar-head",
  "sidebar-title",
  "citations-label",
  "feedback-label",
  "md-link",
  "header-actions",
  "disclaimer",
  "typing",
  "welcome-title",
  "welcome",
  "welcome-card",
  "welcome-card-icon",
  "welcome-card-title",
  "welcome-card-description",
  "welcome-prompt",
  "feedback-note",
  "feedback-thanks",
  "sidebar",
  "sidebar-toggle",
  "new-thread-button",
  "scope-tabs",
  "scope-tab",
  "thread",
  "thread-title",
  "thread-meta",
  "thread-delete",
  "thread-confirm",
  "clarify-options",
  "clarify-option",
  "actions",
  "action",
  "action-title",
  "action-status",
  "action-buttons",
  "action-card",
  "action-details",
  "activity",
  "activity-summary",
  "reasoning",
] as const;

/** Named slots whose default content is native slot fallback. */
export const SLOTS = ["launcher", "header", "header-actions", "empty-state", "footer"] as const;

export const WIDGET_OPTIONS: readonly WidgetOption[] = [
  { key: "projectKey", attr: "project-key", kind: "string", clientOnly: true },
  { key: "apiUrl", attr: "api-url", kind: "string", clientOnly: true },
  { key: "locale", attr: "locale", kind: "string" },
  { key: "context", attr: "context", kind: "context", clientOnly: true },
  { key: "readonly", attr: "readonly", kind: "boolean", clientOnly: true },
  { key: "conversationId", attr: "conversation-id", kind: "string", clientOnly: true },

  { key: "colorScheme", attr: "color-scheme", kind: "enum", values: ["light", "dark", "auto"] },
  { key: "accent", attr: "accent", kind: "css" },
  { key: "radius", attr: "radius", kind: "css" },
  { key: "font", attr: "font", kind: "css" },
  { key: "theme", attr: "theme", kind: "theme" },
  { key: "colorSchemeSelector", attr: "color-scheme-selector", kind: "string" },

  {
    key: "launcher",
    attr: "launcher",
    kind: "enum",
    values: ["bell", "chat", "sparkle", "none"],
  },
  { key: "launcherIconUrl", attr: "launcher-icon-url", kind: "string" },
  { key: "launcherLabel", attr: "launcher-label", kind: "string" },
  {
    key: "position",
    attr: "position",
    kind: "enum",
    values: ["bottom-right", "bottom-left"],
  },
  { key: "offsetX", attr: "offset-x", kind: "int", max: 512 },
  { key: "offsetY", attr: "offset-y", kind: "int", max: 512 },
  { key: "launcherDraggable", attr: "launcher-draggable", kind: "boolean" },

  { key: "mode", attr: "mode", kind: "enum", values: ["floating", "inline"] },
  { key: "openOnLoad", attr: "open-on-load", kind: "boolean" },
  { key: "triggerSelector", attr: "trigger-selector", kind: "string" },
  { key: "hotkey", attr: "hotkey", kind: "string" },
  { key: "suggestedQuestions", attr: "suggested-questions", kind: "stringList", max: 4 },
  { key: "promptGroups", attr: "prompt-groups", kind: "promptGroups" },
  { key: "conversationHistory", attr: "conversation-history", kind: "boolean" },
  { key: "historyLayout", attr: "history-layout", kind: "enum", values: ["stack", "sidebar"] },
  { key: "resumeThread", attr: "resume-thread", kind: "enum", values: ["last", "newest", "none"] },
  { key: "threadIdleMinutes", attr: "thread-idle-minutes", kind: "int", max: 1440 },
  { key: "scopeKey", attr: "scope-key", kind: "string" },
  { key: "feedback", attr: "feedback", kind: "boolean" },
  { key: "feedbackReasons", attr: "feedback-reasons", kind: "reasons" },

  { key: "disclaimer", attr: "disclaimer", kind: "string" },
  { key: "copy", attr: "copy", kind: "copy" },
  { key: "poweredBy", attr: "powered-by", kind: "boolean", clientOnly: true },
] as const;

export const DEFAULTS: WidgetConfig = {
  projectKey: "",
  /** Empty → same-origin relative fetches. */
  apiUrl: "",
  /** Empty → the widget falls back to navigator.language. */
  locale: "",
  colorScheme: "light",
  accent: "#2b6b4f",
  radius: "16px",
  font: "system-ui, -apple-system, sans-serif",
  theme: {},
  launcher: "bell",
  launcherIconUrl: "",
  launcherLabel: "",
  position: "bottom-right",
  offsetX: 20,
  offsetY: 20,
  openOnLoad: false,
  triggerSelector: "",
  hotkey: "",
  suggestedQuestions: [],
  conversationHistory: true,
  feedback: true,
  copy: {},
  poweredBy: true,
  mode: "floating",
  disclaimer: "",
  promptGroups: [],
  feedbackReasons: [],
  launcherDraggable: false,
  colorSchemeSelector: "",
  context: {},
  scopeKey: "",
  historyLayout: "stack",
  resumeThread: "last",
  threadIdleMinutes: 30,
  readonly: false,
  conversationId: "",
};

const TOKEN_SET = new Set<string>(TOKENS);
const COPY_KEY_SET = new Set<string>(COPY_KEYS);

/**
 * Strip anything that could break out of a CSS declaration.
 *
 * Config reaches the widget from a project's stored appearance and is
 * interpolated into a <style> element in the shadow root. The host page can
 * already write any CSS it likes, but stored config must never be able to
 * inject rules — so `;`, braces, angle brackets, quotes, at-rules and
 * newlines are removed rather than escaped.
 */
export function sanitizeCssValue(value: string): string {
  return value
    .replace(/[;{}<>"'\\@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function parseList(raw: string, max: number): string[] {
  // "|" not "," — questions contain commas.
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** Coerce untrusted input into prompt groups; anything malformed is dropped, never thrown. */
export function parsePromptGroups(input: unknown): PromptGroup[] {
  if (!Array.isArray(input)) return [];
  const L = PROMPT_GROUP_LIMITS;
  const out: PromptGroup[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const g = raw as Record<string, unknown>;
    const title = str(g.title, L.title);
    const prompts = Array.isArray(g.prompts)
      ? g.prompts
          .map((p) => str(p, L.prompt))
          .filter((p): p is string => !!p)
          .slice(0, L.prompts)
      : [];
    if (!title || prompts.length === 0) continue;
    const group: PromptGroup = { title, prompts };
    const description = str(g.description, L.description);
    if (description) group.description = description;
    const icon = str(g.icon, L.icon);
    // An icon is a network request to a host the config chose; only images.
    if (icon && /^(https?:\/\/|data:image\/)/i.test(icon)) group.icon = icon;
    out.push(group);
    if (out.length === L.groups) break;
  }
  return out;
}

/** Coerce untrusted input into feedback reasons; ids must match the wire pattern. */
export function parseFeedbackReasons(input: unknown): FeedbackReasonOption[] {
  if (!Array.isArray(input)) return [];
  const L = FEEDBACK_REASON_LIMITS;
  const out: FeedbackReasonOption[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const label = str(r.label, L.label);
    if (!REASON_ID_PATTERN.test(id) || !label || seen.has(id)) continue;
    seen.add(id);
    const reason: FeedbackReasonOption = { id, label };
    const note = typeof r.note === "number" ? Math.floor(r.note) : Number.NaN;
    if (Number.isFinite(note) && note > 0) reason.note = Math.min(note, L.note);
    out.push(reason);
    if (out.length === L.reasons) break;
  }
  return out;
}

/** Coerce untrusted input into a context object; bad keys and values are dropped. */
export function parseContext(input: unknown): WidgetContext {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const L = CONTEXT_LIMITS;
  const out: WidgetContext = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (key.length > L.key || !CONTEXT_KEY_PATTERN.test(key)) continue;
    if (typeof raw !== "object" || raw === null) continue;
    const id = str((raw as Record<string, unknown>).id, L.id);
    if (!id) continue;
    const name = str((raw as Record<string, unknown>).name, L.name);
    out[key] = name ? { id, name } : { id };
    if (Object.keys(out).length === L.keys) break;
  }
  return out;
}

function parseJsonRecord(raw: string, allowed: Set<string>): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  return pickStrings(parsed, allowed);
}

function pickStrings(input: unknown, allowed: Set<string>): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (allowed.has(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Coerce one raw attribute string. Invalid values fall back to the default
 * rather than throwing: a typo in a customer's embed code must never take the
 * widget down.
 */
export function coerceOption(option: WidgetOption, raw: string): unknown {
  const fallback = DEFAULTS[option.key];
  switch (option.kind) {
    case "string":
      return raw;
    case "css":
      return sanitizeCssValue(raw) || fallback;
    case "int": {
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n)) return fallback;
      return Math.max(0, Math.min(option.max ?? Number.MAX_SAFE_INTEGER, n));
    }
    case "boolean":
      // A bare attribute (`open-on-load`) reads as "" and means true.
      return raw === "" || raw === "true";
    case "enum":
      return option.values?.includes(raw) ? raw : fallback;
    case "stringList":
      return parseList(raw, option.max ?? 8);
    case "theme":
      return parseJsonRecord(raw, TOKEN_SET);
    case "copy":
      return parseJsonRecord(raw, COPY_KEY_SET);
    case "promptGroups":
      return parsePromptGroups(parseJson(raw));
    case "reasons":
      return parseFeedbackReasons(parseJson(raw));
    case "context":
      return parseContext(parseJson(raw));
  }
}

/** Read every known attribute off an element-like source. */
export function configFromAttributes(get: (attr: string) => string | null): Partial<WidgetConfig> {
  const out: Record<string, unknown> = {};
  for (const option of WIDGET_OPTIONS) {
    const raw = get(option.attr);
    if (raw === null) continue;
    out[option.key] = coerceOption(option, raw);
  }
  return out as Partial<WidgetConfig>;
}

/** Coerce an untrusted object (server config, JS `config` call) key by key. */
export function coerceConfigObject(input: unknown): Partial<WidgetConfig> {
  if (typeof input !== "object" || input === null) return {};
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const option of WIDGET_OPTIONS) {
    const value = source[option.key];
    if (value === undefined || value === null) continue;
    if (option.kind === "theme") {
      out[option.key] = pickStrings(value, TOKEN_SET);
    } else if (option.kind === "copy") {
      out[option.key] = pickStrings(value, COPY_KEY_SET);
    } else if (option.kind === "promptGroups") {
      out[option.key] = parsePromptGroups(value);
    } else if (option.kind === "reasons") {
      out[option.key] = parseFeedbackReasons(value);
    } else if (option.kind === "context") {
      out[option.key] = parseContext(value);
    } else if (option.kind === "stringList") {
      out[option.key] = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string").slice(0, option.max ?? 8)
        : [];
    } else if (option.kind === "boolean") {
      out[option.key] = value === true || value === "true";
    } else if (option.kind === "int") {
      out[option.key] = coerceOption(option, String(value));
    } else if (typeof value === "string") {
      out[option.key] = coerceOption(option, value);
    }
  }
  return out as Partial<WidgetConfig>;
}

/**
 * Merge config layers, later wins. `theme` and `copy` merge key-by-key so a
 * per-page override of one token does not wipe the dashboard's theme.
 *
 * Layer order at the call site is defaults → server → attributes → JS config;
 * host-page CSS custom properties beat all of them in the cascade, not here.
 */
export function resolveWidgetConfig(...layers: Partial<WidgetConfig>[]): WidgetConfig {
  const out: WidgetConfig = {
    ...DEFAULTS,
    theme: {},
    copy: {},
    suggestedQuestions: [],
    promptGroups: [],
    feedbackReasons: [],
    context: {},
  };
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined) continue;
      if (k === "theme") {
        out.theme = { ...out.theme, ...(v as Record<string, string>) };
      } else if (k === "copy") {
        out.copy = { ...out.copy, ...(v as Record<string, string>) };
      } else {
        (out as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

/**
 * Resolved config → `--_cfg-*` declarations for the shadow root's generated
 * stylesheet. The widget's static CSS reads
 * `var(--deskbell-x, var(--_cfg-x, var(--_pal-x)))`, so these sit between the
 * palette default and whatever the host page set.
 */
export function configToCssVars(config: WidgetConfig): string {
  const vars: string[] = [];
  const put = (token: TokenName, value: string) => {
    const clean = sanitizeCssValue(value);
    if (clean) vars.push(`--_cfg-${token}:${clean}`);
  };
  // Shorthands are sugar over tokens; an explicit theme entry wins.
  if (config.accent) put("accent", config.accent);
  if (config.radius) put("radius", config.radius);
  if (config.font) put("font", config.font);
  put("launcher-offset-x", `${config.offsetX}px`);
  put("launcher-offset-y", `${config.offsetY}px`);
  for (const [token, value] of Object.entries(config.theme)) {
    if (TOKEN_SET.has(token) && typeof value === "string") put(token as TokenName, value);
  }
  return vars.join(";");
}
