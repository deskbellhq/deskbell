"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { Download } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { type LogStatusKey, type LogView, logHref, STATUS_VIEW_LABEL } from "@/lib/actions/log";
import type { ServerOption } from "@/lib/actions/log-query";
import { DEFAULT_PERIOD, type PeriodKey } from "@/lib/gaps-view";

/**
 * Period, status, server and tool for the actions log (spec: actions-log).
 * All four live in the URL so a view is a link. Period and status are rows
 * of links; server and tool are selects that rewrite the query string and
 * keep the rest. Choosing a server clears a tool that is not its own.
 */
const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: "7d", label: "Last 7 days", short: "7d" },
  { key: "30d", label: "Last 30 days", short: "30d" },
  { key: "90d", label: "Last 90 days", short: "90d" },
  { key: "all", label: "All time", short: "All" },
];

const STATUSES: LogStatusKey[] = ["all", "done", "failed", "awaiting", "declined", "expired"];
const ANY = "__any";

export function ActionsLogToolbar({
  view,
  servers,
}: {
  view: Omit<LogView, "call">;
  servers: ServerOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const href = (next: Partial<LogView>) => logHref(pathname, { ...view, ...next }, DEFAULT_PERIOD);
  const server = servers.find((s) => s.id === view.server) ?? null;
  const tools = server ? server.tools : servers.flatMap((s) => s.tools);
  const exportHref = `${pathname}/export${href({}).slice(pathname.length)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="flex rounded-md border">
        {PERIODS.map((p) => (
          <Button
            key={p.key}
            asChild
            variant={p.key === view.period ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none first:rounded-l-md last:rounded-r-md"
          >
            <Link
              href={href({ period: p.key })}
              aria-current={p.key === view.period ? "page" : undefined}
            >
              <span className="hidden sm:inline">{p.label}</span>
              <span className="sm:hidden">{p.short}</span>
            </Link>
          </Button>
        ))}
      </nav>
      <nav aria-label="Status" className="flex rounded-md border">
        {STATUSES.map((s) => (
          <Button
            key={s}
            asChild
            variant={s === view.status ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none first:rounded-l-md last:rounded-r-md"
          >
            <Link href={href({ status: s })} aria-current={s === view.status ? "page" : undefined}>
              {STATUS_VIEW_LABEL[s]}
            </Link>
          </Button>
        ))}
      </nav>
      {servers.length > 1 ? (
        <Select
          value={view.server ?? ANY}
          onValueChange={(id) =>
            router.push(
              href({
                server: id === ANY ? null : id,
                // A tool belongs to a server; keep it only while it still applies.
                tool:
                  id === ANY ||
                  servers.find((s) => s.id === id)?.tools.some((t) => t.name === view.tool)
                    ? view.tool
                    : null,
              }),
            )
          }
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Server">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All servers</SelectItem>
            {servers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {tools.length > 0 ? (
        <Select
          value={view.tool ?? ANY}
          onValueChange={(name) => router.push(href({ tool: name === ANY ? null : name }))}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Tool">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All tools</SelectItem>
            {[...new Map(tools.map((t) => [t.name, t])).values()].map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button variant="outline" size="sm" asChild>
        {/* A plain anchor: a download needs a navigation, not a client transition. */}
        <a href={exportHref} download>
          <Download />
          CSV
        </a>
      </Button>
    </div>
  );
}
