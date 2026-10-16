/**
 * Human-facing metadata for the widget's config surface: labels, help text,
 * grouping and control types.
 *
 * Kept apart from ./widget-config.ts on purpose — the widget loads that module
 * at runtime and none of this English belongs in a bundle that ships on
 * customers' pages. The `Record<WidgetOptionKey, …>` type makes the mapping
 * exhaustive: add an option without describing it and typecheck fails.
 *
 * Consumed by the dashboard's Appearance editor and by scripts/gen-widget-docs.ts.
 */

import type { TokenName, WidgetOptionKey } from "./widget-config.ts";

export type OptionGroup = "Identity" | "Theme" | "Launcher" | "Behaviour" | "Content";

export type OptionControl = "text" | "color" | "select" | "switch" | "number" | "list" | "hidden";

export interface OptionMeta {
  group: OptionGroup;
  label: string;
  help: string;
  control: OptionControl;
}

export const WIDGET_OPTION_META: Record<WidgetOptionKey, OptionMeta> = {
  projectKey: {
    group: "Identity",
    label: "Project key",
    help: "Public widget key. Not a secret — origin binding is the control.",
    control: "hidden",
  },
  apiUrl: {
    group: "Identity",
    label: "API URL",
    help: "Your Deskbell server. Leave empty when the widget is on the same origin.",
    control: "hidden",
  },
  locale: {
    group: "Identity",
    label: "Locale",
    help: "BCP-47 tag for the visitor's language. Defaults to the browser's.",
    control: "text",
  },
  context: {
    group: "Identity",
    label: "Context",
    help: 'Where on your site the conversation starts, as JSON: { "account": { "id": "…", "name": "…" } }. Stored with the thread, shown in the dashboard.',
    control: "hidden",
  },
  readonly: {
    group: "Identity",
    label: "Read-only",
    help: "Show one conversation with no composer, for support staff whose token carries the project's staff claim.",
    control: "hidden",
  },
  conversationId: {
    group: "Identity",
    label: "Conversation id",
    help: "The conversation to open on load. With read-only it loads through the staff preview.",
    control: "hidden",
  },
  colorScheme: {
    group: "Theme",
    label: "Colour scheme",
    help: "Light, dark, or follow the visitor's system setting.",
    control: "select",
  },
  accent: {
    group: "Theme",
    label: "Accent colour",
    help: "Drives the launcher, header, your messages and focus rings.",
    control: "color",
  },
  radius: {
    group: "Theme",
    label: "Corner radius",
    help: "Border radius of the chat panel, e.g. 16px or 0.",
    control: "text",
  },
  font: {
    group: "Theme",
    label: "Font stack",
    help: "Any CSS font-family value. Load the font on your own page.",
    control: "text",
  },
  theme: {
    group: "Theme",
    label: "Theme tokens",
    help: "Fine-grained overrides for any of the widget's CSS custom properties.",
    control: "hidden",
  },
  colorSchemeSelector: {
    group: "Theme",
    label: "Colour scheme selector",
    help: "CSS selector of the element your site keeps its theme on, e.g. html. A dark or light class or data-theme there overrides the colour scheme.",
    control: "text",
  },
  launcher: {
    group: "Launcher",
    label: "Launcher icon",
    help: "Built-in icon, or 'none' if you open the widget from your own button.",
    control: "select",
  },
  launcherIconUrl: {
    group: "Launcher",
    label: "Custom icon URL",
    help: "Square image used instead of the built-in icon.",
    control: "text",
  },
  launcherLabel: {
    group: "Launcher",
    label: "Launcher label",
    help: "Text beside the icon, e.g. 'Ask AI'. Turns the circle into a pill.",
    control: "text",
  },
  position: {
    group: "Launcher",
    label: "Position",
    help: "Which corner the launcher sits in.",
    control: "select",
  },
  offsetX: {
    group: "Launcher",
    label: "Horizontal offset",
    help: "Distance from the side of the viewport, in pixels.",
    control: "number",
  },
  offsetY: {
    group: "Launcher",
    label: "Vertical offset",
    help: "Distance from the bottom of the viewport, in pixels.",
    control: "number",
  },
  mode: {
    group: "Behaviour",
    label: "Mode",
    help: "Floating: a launcher opens a panel. Inline: the widget fills its container and is always open; give the element a height.",
    control: "select",
  },
  launcherDraggable: {
    group: "Launcher",
    label: "Draggable launcher",
    help: "Let visitors drag the launcher anywhere on screen. The panel follows; the position is not remembered.",
    control: "switch",
  },
  openOnLoad: {
    group: "Behaviour",
    label: "Open on load",
    help: "Open the panel automatically when the page loads.",
    control: "switch",
  },
  triggerSelector: {
    group: "Behaviour",
    label: "Trigger selector",
    help: "CSS selector — clicking any matching element opens the widget.",
    control: "text",
  },
  hotkey: {
    group: "Behaviour",
    label: "Keyboard shortcut",
    help: "Shortcut that opens the widget, e.g. mod+k. Empty to disable.",
    control: "text",
  },
  suggestedQuestions: {
    group: "Content",
    label: "Suggested questions",
    help: "Up to four starter questions shown in the empty state.",
    control: "list",
  },
  promptGroups: {
    group: "Content",
    label: "Welcome cards",
    help: "Cards in the empty state, each a title, optional description and icon, and up to six prompts. JSON; replaces the suggested questions when set.",
    control: "hidden",
  },
  conversationHistory: {
    group: "Behaviour",
    label: "Conversation history",
    help: "Let visitors return to their recent conversations.",
    control: "switch",
  },
  historyLayout: {
    group: "Behaviour",
    label: "History layout",
    help: "Stack: a list view behind a back button. Sidebar: threads in a collapsible rail beside the conversation, with delete.",
    control: "select",
  },
  resumeThread: {
    group: "Behaviour",
    label: "Resume",
    help: "What a fresh open shows: the thread this browser last had open, the visitor's newest thread, or nothing.",
    control: "select",
  },
  threadIdleMinutes: {
    group: "Behaviour",
    label: "Thread idle minutes",
    help: "A thread silent for this long is not resumed; the next question starts a new one. 0 never rolls over.",
    control: "number",
  },
  scopeKey: {
    group: "Behaviour",
    label: "Scope key",
    help: "A key of the page's context. When present, the sidebar can show only the threads started under that key's value.",
    control: "text",
  },
  feedback: {
    group: "Behaviour",
    label: "Answer feedback",
    help: "Show thumbs up/down under answers. Feeds the docs-gap analytics.",
    control: "switch",
  },
  feedbackReasons: {
    group: "Behaviour",
    label: "Feedback reasons",
    help: "Reasons offered on a downvote, each with an id, a label and an optional free-text limit. JSON; empty means the built-in three.",
    control: "hidden",
  },
  disclaimer: {
    group: "Content",
    label: "Disclaimer",
    help: "Short notice above the footer, e.g. that answers are AI-generated. Markdown links work.",
    control: "text",
  },
  copy: {
    group: "Content",
    label: "Copy",
    help: "Override any of the widget's UI strings.",
    control: "hidden",
  },
  poweredBy: {
    group: "Content",
    label: "Powered by Deskbell",
    help: "Removing the badge requires an enterprise licence.",
    control: "hidden",
  },
};

/** One-line descriptions for the generated token reference. */
export const TOKEN_HELP: Record<TokenName, string> = {
  surface: "Panel background",
  "surface-subtle": "Assistant bubbles, pills, chips",
  "surface-hover": "Hover background for rows and buttons",
  "surface-active": "Pressed/active background",
  text: "Primary text",
  "text-secondary": "Chip and pill text",
  "text-muted": "Secondary text, refusals, empty state",
  "text-subtle": "Timestamps, labels, placeholders",
  border: "Dividers and input borders",
  "border-strong": "Chip borders",
  accent: "Brand colour",
  "accent-contrast": "Text on the accent colour",
  "accent-subtle": "Tinted accent background",
  "header-bg": "Panel header background",
  "header-text": "Panel header text",
  "bubble-user-bg": "Visitor message background",
  "bubble-user-fg": "Visitor message text",
  "bubble-assistant-bg": "Answer background",
  "bubble-assistant-fg": "Answer text",
  "bubble-radius": "Message bubble radius",
  "launcher-bg": "Launcher background",
  "launcher-fg": "Launcher icon colour",
  "launcher-size": "Launcher diameter",
  "launcher-offset-x": "Launcher distance from the side",
  "launcher-offset-y": "Launcher distance from the bottom",
  radius: "Panel corner radius",
  "panel-width": "Panel width",
  "panel-height": "Panel height",
  shadow: "Panel shadow",
  z: "Stacking order",
  font: "Font stack",
  "font-size": "Base font size",
  "control-radius": "Pills and buttons",
  "input-radius": "Text inputs",
  "focus-ring": "Focus outline colour",
  "code-bg": "Fenced code block background in answers",
  "code-fg": "Fenced code block text in answers",
};
