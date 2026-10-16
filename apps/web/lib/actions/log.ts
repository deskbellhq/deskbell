import type { ActionCallStatus, ActionDetail } from "@deskbell/shared";

import { csvCell } from "@/lib/csv";
import type { PeriodKey } from "@/lib/gaps-view";

/**
 * The actions log (spec: actions-log): the pure half. What the URL says,
 * what a row is called, and how the rows become a CSV. The query lives in
 * `log-query.ts`; the page and the drawer render what this names.
 */

export type LogStatusKey = "all" | "done" | "failed" | "awaiting" | "declined" | "expired";
export const DEFAULT_LOG_STATUS: LogStatusKey = "all";

const STATUS_KEYS: readonly LogStatusKey[] = [
  "all",
  "done",
  "failed",
  "awaiting",
  "declined",
  "expired",
];

/** Which stored statuses a view shows; `all` shows everything. */
export const STATUS_VIEW: Record<Exclude<LogStatusKey, "all">, readonly ActionCallStatus[]> = {
  done: ["succeeded", "approved"],
  failed: ["failed"],
  awaiting: ["pending_approval", "running"],
  declined: ["denied"],
  expired: ["expired"],
};

export const STATUS_VIEW_LABEL: Record<LogStatusKey, string> = {
  all: "All",
  done: "Done",
  failed: "Failed",
  awaiting: "Awaiting",
  declined: "Declined",
  expired: "Expired",
};

/** What a row's chip says. */
export const CALL_STATUS_LABEL: Record<ActionCallStatus, string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  pending_approval: "Awaiting confirmation",
  approved: "Confirmed",
  denied: "Declined",
  expired: "Expired",
};

export interface LogView {
  period: PeriodKey;
  status: LogStatusKey;
  server: string | null;
  tool: string | null;
  call: string | null;
}

type Param = string | string[] | undefined;
const one = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

export function resolveLogStatus(param: Param): LogStatusKey {
  const key = one(param);
  return STATUS_KEYS.includes(key as LogStatusKey) ? (key as LogStatusKey) : DEFAULT_LOG_STATUS;
}

/** An id-shaped parameter: one value, trimmed, or null. */
export function resolveId(param: Param): string | null {
  const value = one(param)?.trim();
  return value ? value.slice(0, 200) : null;
}

/** The URL for a view; defaults are omitted so the plain path is the default view. */
export function logHref(
  pathname: string,
  view: Partial<LogView>,
  defaultPeriod: PeriodKey,
): string {
  const params = new URLSearchParams();
  if (view.period && view.period !== defaultPeriod) params.set("period", view.period);
  if (view.status && view.status !== DEFAULT_LOG_STATUS) params.set("status", view.status);
  if (view.server) params.set("server", view.server);
  if (view.tool) params.set("tool", view.tool);
  if (view.call) params.set("call", view.call);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export interface LogRow {
  id: string;
  createdAt: Date;
  respondedAt: Date | null;
  expiresAt: Date | null;
  serverId: string | null;
  serverName: string | null;
  tool: string;
  title: string;
  status: ActionCallStatus;
  latencyMs: number | null;
  conversationId: string;
  messageId: string | null;
  /** The visitor's question the call answered, when the message is still there. */
  question: string | null;
  visitorId: string | null;
  visitorName: string | null;
  input: Record<string, unknown>;
  details: ActionDetail[] | null;
  output: unknown;
  outputTruncated: boolean;
  error: string | null;
}

export const CSV_COLUMNS = [
  "id",
  "created_at",
  "server",
  "tool",
  "title",
  "status",
  "latency_ms",
  "conversation_id",
  "message_id",
  "visitor_id",
  "input",
  "output",
  "output_truncated",
  "error",
  "responded_at",
] as const;

function json(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function toCsv(rows: LogRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const cells: Record<(typeof CSV_COLUMNS)[number], string | number | null> = {
      id: r.id,
      created_at: r.createdAt.toISOString(),
      server: r.serverName,
      tool: r.tool,
      title: r.title,
      status: r.status,
      latency_ms: r.latencyMs,
      conversation_id: r.conversationId,
      message_id: r.messageId,
      visitor_id: r.visitorId,
      input: json(r.input),
      output: json(r.output),
      output_truncated: r.outputTruncated ? "true" : "false",
      error: r.error,
      responded_at: r.respondedAt?.toISOString() ?? null,
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(cells[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function exportFilename(view: Pick<LogView, "period" | "status">, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const status = view.status === "all" ? "" : `-${view.status}`;
  return `deskbell-actions-${view.period}${status}-${day}.csv`;
}

/** A question cut for a table cell. */
export function shortQuestion(text: string | null, max = 80): string | null {
  if (!text) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
