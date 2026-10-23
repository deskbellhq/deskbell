/**
 * The widget's shadow-DOM stylesheet.
 *
 * Every visual value reads three deep:
 *   var(--deskbell-x, var(--_cfg-x, var(--_pal-x)))
 *     --_pal-x   palette default, swapped by colour scheme (below)
 *     --_cfg-x   resolved config, written by JS into a second <style> element
 *     --deskbell-x  whatever the host page set — always wins, by cascade
 *
 * That ordering is deliberate: `deskbell-widget { --deskbell-accent: red }` on
 * the host page is the most explicit statement of intent anywhere, so nothing
 * resolved at runtime should beat it. No !important, no inline styles.
 *
 * Token names are declared once in @deskbell/shared/widget-config (TOKENS) and
 * documented in docs/widget-customization.md.
 */
export const CSS = `
:host([data-mode="inline"]) { display: block; }
.root.inline { height: 100%; }
.root {
  --_surface: var(--deskbell-surface, var(--_cfg-surface, var(--_pal-surface)));
  --_surface-subtle: var(--deskbell-surface-subtle, var(--_cfg-surface-subtle, var(--_pal-surface-subtle)));
  --_surface-hover: var(--deskbell-surface-hover, var(--_cfg-surface-hover, var(--_pal-surface-hover)));
  --_surface-active: var(--deskbell-surface-active, var(--_cfg-surface-active, var(--_pal-surface-active)));
  --_text: var(--deskbell-text, var(--_cfg-text, var(--_pal-text)));
  --_text-secondary: var(--deskbell-text-secondary, var(--_cfg-text-secondary, var(--_pal-text-secondary)));
  --_text-muted: var(--deskbell-text-muted, var(--_cfg-text-muted, var(--_pal-text-muted)));
  --_text-subtle: var(--deskbell-text-subtle, var(--_cfg-text-subtle, var(--_pal-text-subtle)));
  --_border: var(--deskbell-border, var(--_cfg-border, var(--_pal-border)));
  --_border-strong: var(--deskbell-border-strong, var(--_cfg-border-strong, var(--_pal-border-strong)));
  --_accent: var(--deskbell-accent, var(--_cfg-accent, #2b6b4f));
  --_accent-contrast: var(--deskbell-accent-contrast, var(--_cfg-accent-contrast, var(--_pal-accent-contrast)));
  --_accent-subtle: var(--deskbell-accent-subtle, var(--_cfg-accent-subtle, var(--_pal-accent-subtle)));
  --_header-bg: var(--deskbell-header-bg, var(--_cfg-header-bg, var(--_accent)));
  --_header-text: var(--deskbell-header-text, var(--_cfg-header-text, var(--_accent-contrast)));
  --_bubble-user-bg: var(--deskbell-bubble-user-bg, var(--_cfg-bubble-user-bg, var(--_accent)));
  --_bubble-user-fg: var(--deskbell-bubble-user-fg, var(--_cfg-bubble-user-fg, var(--_accent-contrast)));
  --_bubble-assistant-bg: var(--deskbell-bubble-assistant-bg, var(--_cfg-bubble-assistant-bg, var(--_surface-subtle)));
  --_bubble-assistant-fg: var(--deskbell-bubble-assistant-fg, var(--_cfg-bubble-assistant-fg, var(--_text)));
  --_bubble-radius: var(--deskbell-bubble-radius, var(--_cfg-bubble-radius, 18px));
  --_launcher-bg: var(--deskbell-launcher-bg, var(--_cfg-launcher-bg, var(--_accent)));
  --_launcher-fg: var(--deskbell-launcher-fg, var(--_cfg-launcher-fg, var(--_accent-contrast)));
  --_launcher-size: var(--deskbell-launcher-size, var(--_cfg-launcher-size, 48px));
  --_launcher-offset-x: var(--deskbell-launcher-offset-x, var(--_cfg-launcher-offset-x, 20px));
  --_launcher-offset-y: var(--deskbell-launcher-offset-y, var(--_cfg-launcher-offset-y, 20px));
  --_radius: var(--deskbell-radius, var(--_cfg-radius, 16px));
  --_panel-width: var(--deskbell-panel-width, var(--_cfg-panel-width, 400px));
  --_panel-height: var(--deskbell-panel-height, var(--_cfg-panel-height, 640px));
  --_shadow: var(--deskbell-shadow, var(--_cfg-shadow, var(--_pal-shadow)));
  --_z: var(--deskbell-z, var(--_cfg-z, 2147483000));
  --_font: var(--deskbell-font, var(--_cfg-font, system-ui, -apple-system, sans-serif));
  --_font-size: var(--deskbell-font-size, var(--_cfg-font-size, 14px));
  --_control-radius: var(--deskbell-control-radius, var(--_cfg-control-radius, 999px));
  --_input-radius: var(--deskbell-input-radius, var(--_cfg-input-radius, 8px));
  --_focus-ring: var(--deskbell-focus-ring, var(--_cfg-focus-ring, var(--_accent)));
  --_code-bg: var(--deskbell-code-bg, var(--_cfg-code-bg, var(--_pal-code-bg)));
  --_code-fg: var(--deskbell-code-fg, var(--_cfg-code-fg, var(--_pal-code-fg)));
}

/* Light is the default and is declared before the media query, so a page that
   never sets a scheme still gets a complete palette. */
.root[data-scheme="light"], .root[data-scheme="auto"] {
  --_pal-surface: #fff;
  --_pal-surface-subtle: #f2f3f5;
  --_pal-surface-hover: #f6f7f8;
  --_pal-surface-active: #e8eaed;
  --_pal-text: #0b0e11;
  --_pal-text-secondary: #40474d;
  --_pal-text-muted: #5f666d;
  --_pal-text-subtle: #6b7280;
  --_pal-border: #ebedef;
  --_pal-border-strong: #d7dade;
  --_pal-accent-contrast: #fff;
  --_pal-accent-subtle: #f2f3f5;
  --_pal-shadow: 0 0 0 1px rgba(0,0,0,.04), 0 12px 48px rgba(0,0,0,.16);
  --_pal-code-bg: #1d2024;
  --_pal-code-fg: #eceff2;
}
.root[data-scheme="dark"] {
  --_pal-surface: #16181b;
  --_pal-surface-subtle: #212429;
  --_pal-surface-hover: #1d2024;
  --_pal-surface-active: #292d33;
  --_pal-text: #eceff2;
  --_pal-text-secondary: #b9c0c7;
  --_pal-text-muted: #949ca4;
  --_pal-text-subtle: #80888f;
  --_pal-border: #2a2e34;
  --_pal-border-strong: #3a3f46;
  --_pal-accent-contrast: #fff;
  --_pal-accent-subtle: #212429;
  --_pal-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 12px 48px rgba(0,0,0,.5);
  --_pal-code-bg: #0f1114;
  --_pal-code-fg: #eceff2;
}
@media (prefers-color-scheme: dark) {
  .root[data-scheme="auto"] {
    --_pal-surface: #16181b;
    --_pal-surface-subtle: #212429;
    --_pal-surface-hover: #1d2024;
    --_pal-surface-active: #292d33;
    --_pal-text: #eceff2;
    --_pal-text-secondary: #b9c0c7;
    --_pal-text-muted: #949ca4;
    --_pal-text-subtle: #80888f;
    --_pal-border: #2a2e34;
    --_pal-border-strong: #3a3f46;
    --_pal-accent-contrast: #fff;
    --_pal-accent-subtle: #212429;
    --_pal-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 12px 48px rgba(0,0,0,.5);
    --_pal-code-bg: #0f1114;
    --_pal-code-fg: #eceff2;
  }
}

.dock {
  position: fixed; bottom: var(--_launcher-offset-y); z-index: var(--_z);
  display: flex;
}
.dock.right { right: var(--_launcher-offset-x); }
.dock.left { left: var(--_launcher-offset-x); }
/* Draggable launcher (spec: widget-launcher-drag). */
.dock.draggable { touch-action: none; cursor: grab; user-select: none; }
.dock.draggable:active { cursor: grabbing; }
/* Dragged into the upper half: the panel opens below the launcher instead. */
.root.below .panel {
  bottom: auto;
  top: calc(100vh - var(--_launcher-offset-y) + 12px);
  height: min(var(--_panel-height), calc(var(--_launcher-offset-y) - 32px));
}
.launcher {
  width: var(--_launcher-size); height: var(--_launcher-size);
  border-radius: var(--_control-radius);
  border: none; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--_launcher-bg); color: var(--_launcher-fg);
  font: inherit; font-family: var(--_font); font-size: var(--_font-size); font-weight: 600;
  box-shadow: 0 2px 8px rgba(0,0,0,.14), 0 8px 24px rgba(0,0,0,.18);
  transition: transform .15s ease;
}
.launcher.labelled { width: auto; padding: 0 18px; }
.launcher:hover { transform: scale(1.06); }
.launcher:active { transform: scale(.97); }
.launcher-ico { display: flex; align-items: center; justify-content: center; }
.launcher-ico img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
.panel {
  position: fixed; bottom: calc(var(--_launcher-offset-y) + var(--_launcher-size) + 12px);
  z-index: var(--_z);
  width: min(var(--_panel-width), calc(100vw - 40px));
  height: min(var(--_panel-height), calc(100vh - var(--_launcher-offset-y) - var(--_launcher-size) - 32px));
  border-radius: var(--_radius); font-family: var(--_font);
  background: var(--_surface); color: var(--_text);
  box-shadow: var(--_shadow);
  display: flex; flex-direction: column; overflow: hidden;
  font-size: var(--_font-size); line-height: 1.5;
}
.panel.right { right: var(--_launcher-offset-x); }
.panel.left { left: var(--_launcher-offset-x); }
/* Inline mode (spec: widget-inline-mode): the host page owns size and placement. */
.panel.inline {
  position: static; width: 100%; height: 100%; max-width: none; max-height: none;
  box-shadow: none; border-radius: 0;
}
.head-actions { display: flex; align-items: center; gap: 6px; }
.head-actions:empty { display: none; }
.head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 18px 20px 14px; background: var(--_header-bg); color: var(--_header-text);
}
.head-left { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.head-back, .close {
  border: none; color: inherit;
  background: color-mix(in srgb, currentColor 15%, transparent);
  width: 28px; height: 28px; border-radius: var(--_control-radius); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; line-height: 1;
}
.head-back { margin-top: 2px; }
.close { font-size: 16px; }
.head-back:hover, .close:hover { background: color-mix(in srgb, currentColor 26%, transparent); }
.head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.head-title { font-size: 16px; font-weight: 600; }
.head-sub { font-size: 12.5px; opacity: .82; }
.columns { display: flex; flex: 1; min-height: 0; position: relative; }
.main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
/* Thread sidebar (spec: widget-thread-sidebar). */
.sidebar {
  width: 220px; flex-shrink: 0; border-right: 1px solid var(--_border);
  display: flex; flex-direction: column; min-height: 0; background: var(--_surface);
}
.sidebar.collapsed { width: 52px; }
.sidebar-head { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.sidebar-btn {
  display: flex; align-items: center; gap: 8px; border: none; background: transparent;
  color: var(--_text-secondary); cursor: pointer; padding: 8px; border-radius: var(--_input-radius);
  font: inherit; font-size: 13px; text-align: left; min-height: 34px;
}
.sidebar-btn:hover { background: var(--_surface-hover); color: var(--_text); }
.sidebar-btn.new { color: var(--_accent); font-weight: 600; }
.scope { display: flex; gap: 4px; padding: 0 8px 8px; }
.scope-tab {
  flex: 1; border: 1px solid var(--_border); background: transparent; color: var(--_text-muted);
  border-radius: var(--_control-radius); padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer;
}
.scope-tab.on { border-color: var(--_accent); color: var(--_accent); background: var(--_accent-subtle); }
.threads { flex: 1; overflow-y: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 2px; }
.sidebar-note { color: var(--_text-muted); font-size: 12.5px; padding: 8px; text-align: center; }
.thread-row { display: flex; align-items: stretch; gap: 2px; }
.thread {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  border: none; background: transparent; color: var(--_text); cursor: pointer;
  padding: 8px; border-radius: var(--_input-radius); font: inherit; text-align: left;
}
.thread:hover { background: var(--_surface-hover); }
.thread.on { background: var(--_surface-active); }
.thread-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread-meta { font-size: 11px; color: var(--_text-subtle); }
.thread-delete {
  border: none; background: transparent; color: var(--_text-subtle); cursor: pointer;
  width: 28px; border-radius: var(--_input-radius); display: flex; align-items: center; justify-content: center;
  opacity: 0;
}
.thread-row:hover .thread-delete, .thread-delete:focus-visible { opacity: 1; }
.thread-delete:hover { background: var(--_surface-hover); color: var(--_text); }
.thread-confirm {
  flex: 1; display: flex; flex-direction: column; gap: 6px; padding: 8px;
  border: 1px solid var(--_border); border-radius: var(--_input-radius); font-size: 12.5px;
}
.thread-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.link {
  border: none; background: transparent; color: var(--_accent); cursor: pointer;
  font: inherit; font-size: 12.5px; padding: 0; text-decoration: underline; text-underline-offset: 2px;
}
.link.danger { color: var(--_text-muted); }
@media (max-width: 480px) {
  .sidebar:not(.collapsed) { position: absolute; inset: 0 auto 0 0; z-index: 1; box-shadow: var(--_shadow); }
}
.list { flex: 1; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; }
.empty { color: var(--_text-muted); text-align: center; margin: auto 0; font-size: 13px; }
.empty-text { display: block; margin: 0 24px; }
.welcome-title { display: block; margin: 0 24px 6px; font-size: 16px; font-weight: 600; color: var(--_text); }
/* Welcome cards (spec: widget-welcome-groups). */
.welcome { display: grid; grid-template-columns: 1fr; gap: 10px; margin: 14px 12px 0; text-align: left; }
.inline .welcome { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card {
  border: 1px solid var(--_border); border-radius: var(--_input-radius); padding: 12px;
  background: var(--_surface); display: flex; flex-direction: column; gap: 6px; min-width: 0;
}
.card-icon { width: 20px; height: 20px; object-fit: contain; }
.card-title { font-weight: 600; font-size: 13.5px; color: var(--_text); }
.card-desc { font-size: 12.5px; color: var(--_text-muted); }
.card-prompts { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.prompt {
  border: none; background: transparent; color: var(--_accent); text-align: left;
  font: inherit; font-size: 13px; cursor: pointer; padding: 3px 0; border-radius: 4px;
}
.prompt:hover { text-decoration: underline; }
.suggestions { display: flex; flex-direction: column; gap: 6px; margin: 14px 12px 0; }
.suggestion {
  border: 1px solid var(--_border); background: var(--_surface); color: var(--_text);
  border-radius: var(--_input-radius); padding: 9px 12px;
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.suggestion:hover { background: var(--_surface-hover); border-color: var(--_border-strong); }
.clarify-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.clarify-option { padding: 6px 10px; }
.clarify-option:disabled { opacity: 0.6; cursor: default; }
.convo {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  border: none; background: transparent; color: inherit; cursor: pointer;
  padding: 10px 12px; border-radius: 12px; font: inherit; text-align: left;
}
.convo:hover { background: var(--_surface-hover); }
.convo-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.convo-title {
  font-weight: 600; font-size: 13.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.convo-snippet {
  color: var(--_text-muted); font-size: 12.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.convo-time { color: var(--_text-subtle); font-size: 11px; flex-shrink: 0; padding-top: 2px; }
.list-footer { padding: 12px; border-top: 1px solid var(--_border); }
.new-btn {
  width: 100%; border: none; border-radius: var(--_control-radius); padding: 10px 16px;
  background: var(--_accent); color: var(--_accent-contrast);
  font: inherit; font-weight: 600; cursor: pointer;
}
.new-btn:hover { filter: brightness(1.05); }
.msg { display: flex; flex-direction: column; gap: 6px; }
.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }
.bubble {
  max-width: 85%; padding: 10px 14px; border-radius: var(--_bubble-radius);
  white-space: pre-wrap; overflow-wrap: break-word;
}
.msg.user .bubble { background: var(--_bubble-user-bg); color: var(--_bubble-user-fg); border-bottom-right-radius: 6px; }
.msg.assistant .bubble { background: var(--_bubble-assistant-bg); color: var(--_bubble-assistant-fg); border-bottom-left-radius: 6px; }
.msg.refused .bubble { color: var(--_text-muted); font-style: italic; }
/* Answers render as Markdown (spec: answer-markdown); blocks own their spacing. */
.bubble.md { white-space: normal; }
.md p, .md ul, .md ol, .md pre, .md blockquote, .md h3, .md h4 { margin: 0 0 8px; }
.md > :last-child { margin-bottom: 0; }
.md h3 { font-size: 15px; font-weight: 600; }
.md h4 { font-size: 14px; font-weight: 600; }
.md ul, .md ol { padding-left: 20px; }
.md li { margin: 2px 0; }
.md-table { overflow-x: auto; margin: 0 0 8px; }
.md table { border-collapse: collapse; font-size: 13px; }
.md th, .md td { border: 1px solid var(--_border); padding: 4px 8px; text-align: left; vertical-align: top; }
.md th { font-weight: 600; }
.md li > ul, .md li > ol { margin: 2px 0 0; }
.md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em;
  background: var(--_surface-active); border-radius: 4px; padding: 1px 5px;
}
.md pre {
  background: var(--_code-bg); color: var(--_code-fg); border-radius: var(--_input-radius);
  padding: 10px 12px; overflow-x: auto; white-space: pre; max-width: 100%;
}
.md pre code { background: transparent; padding: 0; color: inherit; font-size: 12.5px; }
.md blockquote {
  border-left: 3px solid var(--_border-strong); margin-left: 0; padding-left: 10px;
  color: var(--_text-muted);
}
.md hr { border: none; border-top: 1px solid var(--_border); margin: 8px 0; }
.md a { color: var(--_accent); text-decoration: underline; text-underline-offset: 2px; }
.md a:focus-visible { outline: 2px solid var(--_focus-ring); outline-offset: 2px; }
.citations { max-width: 85%; display: flex; flex-direction: column; gap: 5px; }
.citations-label {
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--_text-subtle);
}
.pills { display: flex; flex-wrap: wrap; gap: 6px; }
.pill {
  font-size: 12px; color: var(--_text-secondary); background: var(--_surface-subtle);
  border-radius: var(--_control-radius); padding: 3px 10px; text-decoration: none;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
a.pill:hover { background: var(--_surface-active); color: var(--_accent); }
.pill.written {
  display: inline-grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 6px;
  align-items: center; white-space: normal; text-align: left; padding: 4px 10px 4px 8px;
}
.pill-glyph { grid-row: 1 / span 2; color: var(--_text-muted); }
.pill-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill-label { font-size: 11px; line-height: 1.2; color: var(--_text-muted); }
.activity { max-width: 85%; font-size: 12.5px; }
.activity-summary {
  list-style: none; display: flex; align-items: center; gap: 7px; min-height: 20px;
  cursor: pointer; color: var(--_text-secondary); user-select: none; border-radius: 6px;
}
.activity-summary::-webkit-details-marker { display: none; }
.activity-summary:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
.activity-glyph svg { transition: transform .15s; }
.activity[open] .activity-glyph svg { transform: rotate(90deg); }
.activity-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-body { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding-left: 21px; }
.reasoning {
  border-left: 2px solid var(--_border); padding: 2px 0 2px 10px; color: var(--_text-muted);
  white-space: pre-wrap; overflow-wrap: break-word; line-height: 1.45;
}
.actions { display: flex; flex-direction: column; gap: 4px; }
.action { display: flex; align-items: center; gap: 7px; min-height: 20px; min-width: 0; }
.action-glyph {
  flex: none; width: 14px; height: 14px; display: inline-flex; align-items: center;
  justify-content: center; color: var(--_text-subtle);
}
.action.succeeded .action-glyph, .action.approved .action-glyph { color: var(--_accent); }
.action-title {
  color: var(--_text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.action-status { font-size: 11px; color: var(--_text-subtle); flex: none; }
.action-status:not(.sr-only)::before { content: "·"; margin-right: 6px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.spin {
  display: block; width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid var(--_border-strong); border-top-color: var(--_accent);
  animation: deskbell-spin .8s linear infinite;
}
@keyframes deskbell-spin { to { transform: rotate(360deg); } }
.action-card {
  max-width: 85%; min-width: min(100%, 260px); display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; border: 1px solid var(--_border); border-radius: 14px;
  background: var(--_surface); font-size: 13px;
}
.action-card-eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--_text-muted);
}
.action-card .action-title { font-weight: 600; color: var(--_text); white-space: normal; }
.action-details { display: flex; flex-direction: column; gap: 4px; margin: 0; font-size: 12.5px; }
.action-detail { display: grid; grid-template-columns: minmax(64px, max-content) 1fr; gap: 12px; }
.action-detail dt { color: var(--_text-muted); }
.action-detail dd { margin: 0; color: var(--_text-secondary); overflow-wrap: anywhere; }
.action-summary { margin: 0; color: var(--_text-secondary); font-size: 12.5px; }
.action-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; }
.action-buttons button {
  border: none; border-radius: var(--_control-radius); padding: 6px 14px;
  font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
}
.action-buttons .ghost { background: transparent; color: var(--_text-muted); }
.action-buttons .ghost:hover { background: var(--_surface-subtle); }
.action-buttons .primary { background: var(--_accent); color: var(--_accent-contrast); }
.action-buttons button:disabled { opacity: .4; cursor: default; }
.feedback { display: flex; gap: 2px; }
.fb {
  border: none; background: transparent; color: var(--_text-subtle); cursor: pointer;
  width: 26px; height: 26px; border-radius: var(--_control-radius);
  display: flex; align-items: center; justify-content: center;
}
.fb:hover { background: var(--_surface-subtle); color: var(--_text-secondary); }
.fb:disabled { cursor: default; }
.fb:disabled:hover { background: transparent; color: var(--_text-subtle); }
.fb.on:disabled:hover { color: var(--_accent); background: var(--_accent-subtle); }
.fb.on { color: var(--_accent); background: var(--_accent-subtle); }
.fb-thanks { font-size: 12px; color: var(--_text-muted); align-self: center; margin-left: 6px; }
.reason {
  max-width: 85%; margin-top: 2px; padding: 10px 12px;
  border: 1px solid var(--_border); border-radius: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.reason-title { font-size: 12px; font-weight: 600; color: var(--_text-secondary); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  border: 1px solid var(--_border-strong); background: var(--_surface); color: var(--_text-secondary);
  border-radius: var(--_control-radius); padding: 4px 10px; font-size: 12px;
  cursor: pointer; font-family: inherit;
}
.chip.on { border-color: var(--_accent); color: var(--_accent); background: var(--_accent-subtle); }
.reason input {
  border: 1px solid var(--_border); border-radius: var(--_input-radius); padding: 7px 10px;
  background: var(--_surface); color: var(--_text);
  font: inherit; font-size: 12.5px; outline: none;
}
.reason input:focus { border-color: var(--_accent); }
.reason-count { font-size: 11px; color: var(--_text-subtle); text-align: right; }
.hedge { margin: 8px 0 0; font-size: 12px; color: var(--_text-subtle); }
.reason-note { font-size: 11px; color: var(--_text-subtle); }
.reason-note p { margin: 0; }
.reason-note a { color: inherit; }
.reason-actions { display: flex; justify-content: flex-end; gap: 6px; }
.reason-actions button {
  border: none; border-radius: var(--_control-radius); padding: 5px 12px;
  font-family: inherit; font-size: 12px; cursor: pointer;
}
.reason-actions .ghost { background: transparent; color: var(--_text-muted); }
.reason-actions .ghost:hover { background: var(--_surface-subtle); }
.reason-actions .primary { background: var(--_accent); color: var(--_accent-contrast); }
.reason-actions .primary:disabled { opacity: .4; cursor: default; }
.typing { display: inline-flex; gap: 4px; align-items: center; height: 1em; }
.typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--_text-subtle);
  animation: deskbell-bounce 1.2s infinite ease-in-out;
}
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes deskbell-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: .5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .typing i { animation: none; }
  .launcher { transition: none; }
}
.composer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--_border); }
.composer input {
  flex: 1; border: none; background: transparent; padding: 10px 8px;
  font: inherit; color: inherit; outline: none;
}
.composer input::placeholder { color: var(--_text-subtle); }
.send {
  border: none; width: 34px; height: 34px; border-radius: var(--_control-radius); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--_accent); color: var(--_accent-contrast); cursor: pointer;
  transition: opacity .15s ease;
}
.send:disabled { opacity: .35; cursor: default; }
.footer {
  padding: 7px 12px; border-top: 1px solid var(--_border);
  font-size: 11px; color: var(--_text-subtle); text-align: center;
}
.footer a { color: inherit; text-decoration: none; font-weight: 600; }
.footer a:hover { text-decoration: underline; }
.disclaimer {
  padding: 8px 14px; border-top: 1px solid var(--_border);
  font-size: 11px; color: var(--_text-subtle); text-align: center;
}
.disclaimer p { margin: 0; }
.disclaimer a { color: inherit; }
.launcher:focus-visible, .close:focus-visible, .send:focus-visible, .pill:focus-visible,
.fb:focus-visible, .head-back:focus-visible, .convo:focus-visible, .new-btn:focus-visible,
.chip:focus-visible, .suggestion:focus-visible, .reason-actions button:focus-visible, .action-buttons button:focus-visible,
.prompt:focus-visible, .sidebar-btn:focus-visible, .scope-tab:focus-visible, .thread:focus-visible,
.thread-delete:focus-visible, .link:focus-visible {
  outline: 2px solid var(--_focus-ring); outline-offset: 2px;
}
`;
