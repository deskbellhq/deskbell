import { DeskbellClient, type DeskbellClientOptions } from "@deskbell/sdk";
import {
  coerceConfigObject,
  configFromAttributes,
  configToCssVars,
  resolveWidgetConfig,
  WIDGET_OPTIONS,
  type WidgetConfig,
} from "@deskbell/shared/widget-config";
import { h, render } from "preact";
import { type OpenOptions, Panel, type PanelControls } from "./panel";

/**
 * <deskbell-widget> — shadow-DOM custom element (style isolation both ways).
 *
 * Customization has four layers, each an escape hatch for the one below:
 *   1. attributes on this element (every option in WIDGET_OPTIONS)
 *   2. `--deskbell-*` CSS custom properties — the full token set, see ./styles.ts
 *   3. `::part(...)` on any structural element, for shape and layout
 *   4. `<slot name="launcher|header|empty-state|footer">` to replace markup
 *
 * Host-page CSS always wins over config resolved at runtime; that ordering is
 * the cascade's, not ours (see ./styles.ts).
 *
 * Reference: docs/widget-customization.md (generated from the descriptor).
 * Budget: <=40KB gzip for the whole widget bundle (AGENTS.md rule 5, D11).
 * An iframe mode for strict-CSP customers is planned (spec: widget-iframe-mode).
 */
export class DeskbellWidget extends HTMLElement {
  static observedAttributes = WIDGET_OPTIONS.map((o) => o.attr);

  /** Config set from JS; beats attributes, loses to host-page CSS. */
  private overrides: Partial<WidgetConfig> = {};
  /** Appearance authored in the dashboard; the lowest layer above defaults. */
  private server: Partial<WidgetConfig> = {};
  private controls: PanelControls | null = null;
  private transform: ((markdown: string) => string) | undefined;
  private auth: DeskbellClientOptions["getAuthToken"];
  private slotObserver: MutationObserver | null = null;
  private painted = false;
  private connected = false;
  private ready = false;
  /** Commands that arrived before the panel handed back its controls. */
  private pending: DeskbellCall[] = [];

  connectedCallback() {
    this.connected = true;
    instances.add(this);
    // Slotted children decide layout (an inline widget shows a header only
    // when one is slotted), so a change to them repaints.
    this.slotObserver = new MutationObserver(() => {
      if (this.ready) this.paint();
    });
    this.slotObserver.observe(this, { childList: true });
    // Drain anything dispatched before any widget existed on the page.
    this.pending.push(...pendingCommands.splice(0));
    void this.load();
  }

  attributeChangedCallback() {
    if (this.ready) this.paint();
  }

  disconnectedCallback() {
    this.connected = false;
    this.ready = false;
    this.controls = null;
    this.slotObserver?.disconnect();
    this.slotObserver = null;
    instances.delete(this);
    if (this.shadowRoot) render(null, this.shadowRoot);
  }

  open(options?: OpenOptions) {
    this.run("open", options);
  }
  close() {
    this.run("close");
  }
  toggle() {
    this.run("toggle");
  }
  ask(question: string) {
    this.run("ask", question);
  }

  /**
   * Apply a command, or hold it until the panel is live.
   *
   * `open()` is routinely called before this element can act on it: the
   * loader replays the pre-ready queue before auto-mount, and even after
   * mounting the panel does not exist until the config fetch settles. Dropping
   * those calls would make `deskbell("open")` unreliable in exactly the case
   * the queue exists to serve.
   */
  run(name: string, arg?: unknown) {
    // The token provider needs no panel; applying it late would drop a
    // deskbell("auth", fn) queued before the element was live.
    if (name === "auth") {
      if (typeof arg === "function" || arg == null) {
        this.getAuthToken = (arg ?? undefined) as DeskbellClientOptions["getAuthToken"];
      }
      return;
    }
    const controls = this.controls;
    if (!controls) {
      if (this.pending.length < MAX_PENDING) this.pending.push([name, arg]);
      return;
    }
    if (name === "open") controls.open(isOpenOptions(arg) ? arg : undefined);
    else if (name === "close") controls.close();
    else if (name === "toggle") controls.toggle();
    else if (name === "ask" && typeof arg === "string") controls.ask(arg);
  }

  /**
   * Rewrites each answer's Markdown before it renders (spec: answer-markdown).
   * A property, not an attribute: functions do not serialise. Must be pure; it
   * runs on the streamed prefix at every render.
   */
  get answerTransform(): ((markdown: string) => string) | undefined {
    return this.transform;
  }
  set answerTransform(fn: ((markdown: string) => string) | undefined) {
    this.transform = fn;
    if (this.ready) this.paint();
  }

  /**
   * The signed-in visitor's bearer token, asked for before every request
   * (spec: end-user-identity). A property, not an attribute: a token is not
   * something to write into markup. Return nothing for an anonymous visitor.
   */
  get getAuthToken(): DeskbellClientOptions["getAuthToken"] {
    return this.auth;
  }
  set getAuthToken(fn: DeskbellClientOptions["getAuthToken"]) {
    this.auth = fn;
    if (this.ready) this.paint();
  }

  /** Merge JS config over whatever is already resolved, then repaint. */
  configure(patch: Partial<WidgetConfig>) {
    this.overrides = {
      ...this.overrides,
      ...patch,
      theme: { ...this.overrides.theme, ...patch.theme },
      copy: { ...this.overrides.copy, ...patch.copy },
    };
    if (this.ready) this.paint();
  }

  /**
   * Fetch the dashboard-authored appearance before the first paint.
   *
   * Deferring costs a few dozen milliseconds on a launcher that lives in the
   * corner and is never above the fold; the alternative is repainting the
   * brand colour in front of the visitor, which looks broken. Anything slower
   * than the timeout, or any failure, falls through to the defaults — the
   * widget must render even when the config endpoint does not answer.
   */
  private async load() {
    const projectKey = this.getAttribute("project-key") ?? "";
    if (projectKey) {
      const apiUrl = this.getAttribute("api-url") ?? "";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
      try {
        const client = new DeskbellClient({ baseUrl: apiUrl, projectKey });
        this.server = coerceConfigObject(await client.config({ signal: controller.signal }));
      } catch {
        // Offline, blocked, or slow — defaults are a perfectly good widget.
      } finally {
        clearTimeout(timer);
      }
    }
    if (!this.connected) return;
    this.ready = true;
    this.paint();
  }

  private paint() {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const config = resolveWidgetConfig(
      this.server,
      configFromAttributes((attr) => this.getAttribute(attr)),
      this.overrides,
      // Branding is the server's call and nothing on the page overrides it.
      // A licence term, not DRM — the bundle is MIT and the badge is one line
      // of source away from gone. This just makes the contract mean something.
      this.server.poweredBy === undefined ? {} : { poweredBy: this.server.poweredBy },
    );
    const slots = new Set<string>();
    for (const child of Array.from(this.children)) {
      const name = child.getAttribute("slot");
      if (name) slots.add(name);
    }
    // The host page sizes an inline widget through the element, so the mode
    // is reflected where its CSS can see it (config may come from the server).
    this.setAttribute("data-mode", config.mode);
    // Re-rendering into the same root diffs rather than remounts, so changing
    // an attribute mid-conversation keeps the open thread on screen.
    const first = !this.painted;
    this.painted = true;
    render(
      h(Panel, {
        config,
        cssVars: configToCssVars(config),
        answerTransform: this.transform,
        slots,
        host: this,
        getAuthToken: this.auth,
        onControls: (controls) => {
          this.controls = controls;
          if (this.pending.length === 0) return;
          const queued = this.pending.splice(0);
          for (const [name, arg] of queued) this.run(name, arg);
        },
      }),
      shadow,
    );
    // Once per element: the panel exists and commands apply immediately.
    if (first) {
      this.dispatchEvent(new CustomEvent("deskbell:ready", { bubbles: true, composed: true }));
    }
  }
}

const isOpenOptions = (arg: unknown): arg is OpenOptions => typeof arg === "object" && arg !== null;

/** Hard ceiling on waiting for GET /api/v1/config before the first paint. */
const CONFIG_TIMEOUT_MS = 1200;
/** Bound on buffered commands, so a page with no widget cannot grow one. */
const MAX_PENDING = 32;

type DeskbellCall = [string, unknown?];

const instances = new Set<DeskbellWidget>();
/** Commands dispatched before any <deskbell-widget> was on the page. */
const pendingCommands: DeskbellCall[] = [];

/**
 * The widget JS API, addressed as commands so a page can queue calls before
 * the bundle loads: `deskbell("open")`, `deskbell("ask", "how do I install?")`,
 * `deskbell("config", { accent: "#f00" })`. The loader in
 * @deskbell/widget-snippet flushes its queue through here.
 *
 * Commands apply to every mounted widget — pages have one, and a page with two
 * almost certainly wants both to react.
 */
export function command(name: string, arg?: unknown, extra?: unknown): void {
  // Listener sugar over the events the widget dispatches: works before any
  // widget exists, since the events bubble to window.
  if (name === "on" || name === "off") {
    if (typeof arg === "string" && typeof extra === "function") {
      const method = name === "on" ? "addEventListener" : "removeEventListener";
      window[method](`deskbell:${arg}`, extra as EventListener);
    }
    return;
  }
  if (instances.size === 0) {
    // The loader replays its queue before auto-mount, so this is the normal
    // path for a pre-ready call, not an edge case.
    if (name !== "config" && pendingCommands.length < MAX_PENDING) {
      pendingCommands.push([name, arg]);
    }
    return;
  }
  for (const el of instances) {
    if (name === "open") el.open(isOpenOptions(arg) ? arg : undefined);
    else if (name === "close") el.close();
    else if (name === "toggle") el.toggle();
    else if (name === "ask" && typeof arg === "string") el.ask(arg);
    else if (name === "auth") el.run("auth", arg);
    else if (name === "config" && typeof arg === "object" && arg !== null) {
      el.configure(arg as Partial<WidgetConfig>);
    }
  }
}

export function register(tagName = "deskbell-widget") {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, DeskbellWidget);
  }
}
