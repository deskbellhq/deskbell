import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { type PolicySummary, policySummary, type ServerView } from "@/lib/actions/settings";

/**
 * One row per attached server (spec: actions-settings-ui): its state at a
 * glance and a link to its page. Rows, not cards, so ten servers are a
 * list you can scan rather than ten forms you scroll past.
 */
export function ServerList({ servers }: { servers: ServerView[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {servers.map((server) => (
        <li key={server.id}>
          <Link
            href={`/actions/servers/${server.id}`}
            data-testid={`server-${server.slug}`}
            className="flex items-center gap-4 px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <StatusDot server={server} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{server.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{server.slug}</span>
                {" · "}
                {hostOf(server.url)}
              </div>
            </div>
            <div className="hidden text-right text-xs text-muted-foreground sm:block">
              {summaryOf(server)}
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatusDot({ server }: { server: ServerView }) {
  const { tone, label } = statusOf(server);
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center"
      role="img"
      aria-label={label}
      title={server.status === "ok" || !server.lastError ? label : `${label}: ${server.lastError}`}
    >
      <span
        className={`size-2 rounded-full ${
          tone === "ok"
            ? "bg-emerald-500"
            : tone === "bad"
              ? "bg-destructive"
              : "bg-muted-foreground/40"
        }`}
      />
    </span>
  );
}

export function statusOf(server: ServerView): { tone: "ok" | "bad" | "muted"; label: string } {
  if (!server.enabled) return { tone: "muted", label: "Disabled" };
  if (server.status === "ok") return { tone: "ok", label: "Connected" };
  if (server.status) return { tone: "bad", label: "Unreachable" };
  return { tone: "muted", label: "Not checked yet" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function summaryOf(server: ServerView): string {
  if (!server.enabled) return "Disabled";
  if (server.status && server.status !== "ok" && server.tools.length === 0) return "Unreachable";
  return summarize(policySummary(server.tools));
}

/** "4 tools · 2 allowed · 1 needs confirmation", or what is true instead. */
export function summarize(s: PolicySummary): string {
  if (s.total === 0) return "No tools";
  const parts = [`${s.total} ${s.total === 1 ? "tool" : "tools"}`];
  if (s.allow) parts.push(`${s.allow} allowed`);
  if (s.confirm) parts.push(`${s.confirm} ${s.confirm === 1 ? "needs" : "need"} confirmation`);
  if (!s.allow && !s.confirm) parts.push("all off");
  return parts.join(" · ");
}
