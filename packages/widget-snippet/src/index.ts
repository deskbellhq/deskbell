import { WIDGET_OPTIONS } from "@deskbell/shared/widget-config";
import { type DeskbellStub, readQueue } from "./queue";

/**
 * deskbell.js — the embed script customers load (spec: single-tag-embed-deploy-onboarding).
 *
 * Canonical snippet — one tag, nothing else:
 *
 *   <script async src="https://YOUR_DESKBELL/deskbell.js" data-project-key="pk_..."></script>
 *
 * The loader registers <deskbell-widget> and, when its own tag carries a
 * data-project-key, mounts one automatically. api-url needs no configuration:
 * deskbell.js is served by the Deskbell deployment itself, so the script's own
 * origin IS the API origin (a CDN-hosted widget can't know this; self-host can).
 * Every widget attribute works as a data-* attribute on the tag — data-accent,
 * data-position, data-open-on-load, … (docs/widget-customization.md) — and an
 * explicit data-api-url overrides the derived origin (proxy setups).
 *
 * Advanced placement — the manual element keeps working; auto-mount defers to
 * DOM-ready and skips itself when any <deskbell-widget> exists:
 *
 *   <script async src="https://YOUR_DESKBELL/deskbell.js"></script>
 *   <deskbell-widget project-key="pk_..." api-url="https://YOUR_DESKBELL"></deskbell-widget>
 *
 * Do not combine data-project-key with a manual element injected after
 * DOM-ready — auto-mount will already have added one.
 *
 * `data-render-on-load="false"` keeps the loader from mounting; the page then
 * calls `deskbell("mount")` when it wants the widget (a single-page app that
 * shows it on some routes) and `deskbell("unmount")` to take it down.
 *
 * Pre-ready calls (cal.com pattern, spec: widget-js-api): pages that call
 * `deskbell("open")` before deskbell.js loads use the stub
 * `window.deskbell = function(){(window.deskbell.q ??= []).push(arguments)}` —
 * the queue is replayed here, then the stub is replaced with the live dispatcher.
 */

type DeskbellGlobal = Window & { deskbell?: DeskbellStub };

// Captured synchronously at module evaluation: document.currentScript is only
// set during the script's own top-level execution — after the first await in
// boot() it is null — so these reads must stay above it.
const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
const autoProjectKey = script?.getAttribute("data-project-key")?.trim() ?? "";
const autoApiUrl = script?.src ? new URL(script.src).origin : "";
const renderOnLoad = script?.getAttribute("data-render-on-load") !== "false";

export async function boot() {
  const { register, command } = await import("@deskbell/widget");
  register();

  // Replay calls the pre-load stub queued, then take over window.deskbell.
  // The stub is a function AND carries `.q`, so the queue must be read off it
  // whatever its typeof says — testing for "function" first drops every
  // pre-ready call. Replayed commands are buffered by the dispatcher until a
  // widget is mounted and its panel is live (see widget-core).
  const mount = (overrides?: unknown) => {
    // A manual element anywhere wins, and a double-included tag is a no-op.
    if (document.querySelector("deskbell-widget")) return;
    const el = document.createElement("deskbell-widget");
    if (autoApiUrl) el.setAttribute("api-url", autoApiUrl);
    // Forward the element's whole attribute surface from data-* on the tag —
    // WIDGET_OPTIONS is the same descriptor the element parses with, so the
    // two can never drift. `deskbell("mount", { key: value })` overrides per call.
    const extra =
      typeof overrides === "object" && overrides !== null
        ? (overrides as Record<string, unknown>)
        : {};
    for (const { attr, key } of WIDGET_OPTIONS) {
      const value =
        extra[key] !== undefined ? String(extra[key]) : script?.getAttribute(`data-${attr}`);
      if (value !== null && value !== undefined) el.setAttribute(attr, value);
    }
    if (!el.getAttribute("project-key")) return; // nothing to mount without a project
    document.body.appendChild(el);
  };
  const unmount = () => {
    for (const el of Array.from(document.querySelectorAll("deskbell-widget"))) el.remove();
  };
  const dispatch = (name: string, arg?: unknown, extra?: unknown) => {
    if (name === "mount") mount(arg);
    else if (name === "unmount") unmount();
    else command(name, arg, extra);
  };

  const global = window as DeskbellGlobal;
  const queued = readQueue(global.deskbell);
  global.deskbell = dispatch;
  for (const [name, arg, extra] of queued) dispatch(name, arg, extra);

  if (!autoProjectKey || !renderOnLoad) return; // the page owns mounting

  // An async script can execute mid-parse: wait for the full DOM so that
  // document.body exists and a manual <deskbell-widget> later in the HTML is
  // seen by the guard above.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
  } else {
    mount();
  }
}

// deskbell.js is a side-effecting script tag — register (and maybe mount) on load.
void boot();
