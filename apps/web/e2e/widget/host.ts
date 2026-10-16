import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { conversations, createDb, projects, widgetInstalls } from "@deskbell/db";
import type { Page, Route } from "@playwright/test";
import { eq } from "drizzle-orm";
import { importJWK, SignJWT } from "jose";
import { e2eDatabaseUrl } from "../database";
import { WIDGET } from "../seed";

/**
 * A stand-in host page for the widget (spec: widget-browser-tests). Served
 * at a real foreign origin through request interception, so the server sees
 * the Origin header a customer's page would send and the allowlist is
 * exercised for real. The page loads `deskbell.js` from the server under
 * test, places the element by hand, and records the widget's events.
 */
export const SERVER = process.env.E2E_BASE_URL ?? "http://localhost:3300";
export const HOST = WIDGET.hostOrigin;

export interface HostOptions {
  /** Attributes on <deskbell-widget>; project-key and api-url are filled in. */
  attrs?: Record<string, string>;
  /** Light-DOM children of the element, e.g. a slotted header. */
  children?: string;
  /** A bearer the page hands the widget through getAuthToken. */
  token?: string;
  /** Inline style on the element; inline mode needs a height. */
  style?: string;
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function hostHtml(o: HostOptions = {}): string {
  const attrs = Object.entries({ "project-key": WIDGET.projectKey, "api-url": SERVER, ...o.attrs })
    .map(([k, v]) => (v === "" ? k : `${k}="${escapeAttr(v)}"`))
    .join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Host</title></head><body>
<h1>Host page</h1>
<script>
  window.__events = [];
  for (const n of ["ready", "answer", "clarify", "limited", "unauthorized", "preview", "conversation", "citation", "action", "confirm"]) {
    window.addEventListener("deskbell:" + n, (e) => window.__events.push({ name: n, detail: e.detail }));
  }
  window.__token = ${JSON.stringify(o.token ?? null)};
</script>
<deskbell-widget ${attrs}${o.style ? ` style="${escapeAttr(o.style)}"` : ""}>${o.children ?? ""}</deskbell-widget>
<script async src="${SERVER}/deskbell.js"></script>
<script>
  customElements.whenDefined("deskbell-widget").then(() => {
    const el = document.querySelector("deskbell-widget");
    if (window.__token) el.getAuthToken = () => window.__token;
  });
</script>
</body></html>`;
}

/**
 * Puts the stand-in origin on the seeded project's allowlist. The seed leaves
 * the list empty because the dashboard's first-run guide asserts on that, and
 * project order is not guaranteed (the widget projects have no dependencies,
 * so they may run first), so `resetHostState` undoes this and the install
 * beacon in `test.afterAll`. Idempotent; call it from `test.beforeAll`.
 */
export async function allowHostOrigin(): Promise<void> {
  const db = createDb(e2eDatabaseUrl());
  try {
    await db
      .update(projects)
      .set({ allowedOrigins: [HOST] })
      .where(eq(projects.publicKey, WIDGET.projectKey));
  } finally {
    await db.$client.end();
  }
}

/** Back to the seeded state: empty allowlist, no install rows, no soft deletes. */
export async function resetHostState(): Promise<void> {
  const db = createDb(e2eDatabaseUrl());
  try {
    await db
      .update(projects)
      .set({ allowedOrigins: [] })
      .where(eq(projects.publicKey, WIDGET.projectKey));
    await db.delete(widgetInstalls).where(eq(widgetInstalls.projectId, "proj_dev"));
    await db
      .update(conversations)
      .set({ deletedAt: null })
      .where(eq(conversations.projectId, "proj_dev"));
  } finally {
    await db.$client.end();
  }
}

/** Undoes a spec's soft delete so the same spec passes again at the next width. */
export async function restoreSeededThreads(): Promise<void> {
  const db = createDb(e2eDatabaseUrl());
  try {
    await db
      .update(conversations)
      .set({ deletedAt: null })
      .where(eq(conversations.projectId, "proj_dev"));
  } finally {
    await db.$client.end();
  }
}

export async function openHost(page: Page, o: HostOptions = {}): Promise<void> {
  // What went wrong on the page shows up in the runner's output, not only as
  // a missing element thirty seconds later.
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[page console]", m.text());
  });
  page.on("requestfailed", (r) => {
    // A beacon cut off by navigation is not a failure worth reading.
    if (r.failure()?.errorText === "net::ERR_ABORTED") return;
    console.log("[request failed]", r.url(), r.failure()?.errorText);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) console.log("[http]", r.status(), r.url());
  });
  await page.route(`${HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: hostHtml(o) }),
  );
  await page.goto(`${HOST}/`);
}

/** The events the page recorded, oldest first. */
export function recordedEvents(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __events: Array<{ name: string; detail: unknown }> }).__events,
  );
}

const CORS = {
  "access-control-allow-origin": HOST,
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "POST, OPTIONS",
};

/** Answers the browser's preflight for a stubbed endpoint. */
function preflight(route: Route): boolean {
  if (route.request().method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: CORS });
  return true;
}

/** Stubs the ask endpoint with an SSE answer; the server is never asked. */
export async function stubAsk(
  page: Page,
  answer: { text: string; citations?: unknown[] },
): Promise<void> {
  await stubAskFrames(page, [
    [
      { type: "token", value: answer.text },
      ...(answer.citations ? [{ type: "citations", citations: answer.citations }] : []),
      { type: "done", conversationId: "conv_stub", messageId: "msg_stub" },
    ],
  ]);
}

/**
 * Stubs the ask endpoint with one scripted stream per call, in order; the
 * last script answers every call after it. For exchanges that take more than
 * one turn, like a clarifying question and the pick that follows it. Returns
 * what the widget posted each time.
 */
export async function stubAskFrames(page: Page, scripts: object[][]): Promise<() => unknown[]> {
  // What the widget posted each time, for a spec that checks the request —
  // the answer to a confirmation card, say (spec: mcp-actions).
  const posted: unknown[] = [];
  await page.route(`${SERVER}/api/v1/ask`, (route) => {
    if (preflight(route)) return;
    posted.push(route.request().postDataJSON());
    const frames = scripts[Math.min(posted.length - 1, scripts.length - 1)] ?? [];
    const body = `: open\n\n${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")}`;
    void route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream" },
      body,
    });
  });
  return () => posted;
}

/** Stubs the feedback endpoint and collects what the widget posted. */
export async function stubFeedback(page: Page): Promise<() => unknown[]> {
  const posted: unknown[] = [];
  await page.route(`${SERVER}/api/v1/feedback`, (route) => {
    if (preflight(route)) return;
    posted.push(route.request().postDataJSON());
    void route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: "{}",
    });
  });
  return () => posted;
}

const KEY_FILE = fileURLToPath(new URL("../.auth/identity-key.json", import.meta.url));

/** A token the seeded project verifies; `exp` in the past makes an expired one. */
export async function signToken(
  claims: Record<string, unknown> & { sub: string },
  opts: { exp?: string } = {},
): Promise<string> {
  const key = await importJWK(JSON.parse(readFileSync(KEY_FILE, "utf8")), "ES256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "e2e" })
    .setIssuer(WIDGET.issuer)
    .setAudience(WIDGET.audience)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "10m")
    .sign(key);
}
