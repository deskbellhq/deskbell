import { actionServers } from "@deskbell/db";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionCallsTable } from "@/components/action-calls-table";
import { logHref } from "@/lib/actions/log";
import { loadActionCalls } from "@/lib/actions/log-query";
import { serverView } from "@/lib/actions/settings";
import { loadToolUsage, usageKey } from "@/lib/actions/usage-query";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { DEFAULT_PERIOD } from "@/lib/gaps-view";
import { formatLatency } from "@/lib/latency";
import { getDefaultProject } from "@/lib/org";

import { HintBadges, LabelField, PolicyControl } from "../../tool-fields";

export const dynamic = "force-dynamic";

const USAGE_DAYS = 30;
const RECENT = 25;

/**
 * One tool (spec: actions-ia): what it is called, whether it is on, what
 * the model is told, what it takes, and what it did lately. Usage sits
 * beside the switch that changes it, so "this tool is slow" and "turn it
 * off" are one screen apart from each other.
 */
export default async function ToolPage({
  params,
}: {
  params: Promise<{ serverId: string; tool: string }>;
}) {
  const [{ serverId, tool: rawTool }, { role }, project] = await Promise.all([
    params,
    requireMember(),
    getDefaultProject(),
  ]);
  const toolName = decodeURIComponent(rawTool);
  const canEdit = role === "owner" || role === "admin";
  const db = getDb();
  const row = await db.query.actionServers.findFirst({
    where: and(
      eq(actionServers.id, serverId),
      eq(actionServers.projectId, project.id),
      eq(actionServers.orgId, project.orgId),
    ),
  });
  if (!row) notFound();
  const server = serverView(row);
  const tool = server.tools.find((t) => t.name === toolName);
  if (!tool) notFound();
  const definition = (row.tools ?? []).find((t) => t.name === toolName);

  const from = new Date(Date.now() - USAGE_DAYS * 86_400_000);
  const [usageMap, calls] = await Promise.all([
    loadToolUsage(db, project, from),
    loadActionCalls(
      db,
      project,
      { period: "all", status: "all", server: server.id, tool: toolName },
      null,
      { limit: RECENT },
    ),
  ]);
  const usage = usageMap.get(usageKey(server.id, toolName)) ?? null;
  const logView = {
    period: "all" as const,
    status: "all" as const,
    server: server.id,
    tool: toolName,
  };
  const shown = tool.label || tool.title;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/actions"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Actions
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-pretty break-words">
                {shown}
              </h1>
              {tool.readOnly ? <Badge variant="outline">lookup</Badge> : null}
              <HintBadges tool={tool} />
            </div>
            <p className="text-sm text-muted-foreground">
              <code>{tool.name}</code>
              {" · "}
              <Link
                href={`/actions/servers/${server.id}`}
                className="underline-offset-4 hover:underline"
              >
                {server.name}
              </Link>
              {!server.enabled ? " · server off, so this tool is not offered" : ""}
            </p>
          </div>
          <PolicyControl serverId={server.id} tool={tool} policy={tool.policy} canEdit={canEdit} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">What the model is told</h2>
            <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
              {tool.description || <em>No description — the model is told only the name.</em>}
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">Input</h2>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(definition?.inputSchema ?? {}, null, 2)}
            </pre>
          </section>
        </div>
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">Label</h2>
            <LabelField tool={tool} serverId={server.id} canEdit={canEdit} />
            <p className="text-xs text-muted-foreground">
              Printed as “{shown}…” while the tool runs and on its confirmation card.
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">Last {USAGE_DAYS} days</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Calls</dt>
              <dd className="tabular-nums">{usage?.calls ?? 0}</dd>
              <dt className="text-muted-foreground">Failed</dt>
              <dd className={`tabular-nums${usage?.failed ? " text-destructive" : ""}`}>
                {usage?.failed ?? 0}
              </dd>
              <dt className="text-muted-foreground">Median</dt>
              <dd className="tabular-nums">
                {usage?.medianMs != null ? formatLatency(usage.medianMs) : "—"}
              </dd>
            </dl>
          </section>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium">Recent calls</h2>
          {calls.length > 0 ? (
            <Button variant="link" size="sm" className="px-0" asChild>
              <Link href={logHref("/actions/log", logView, DEFAULT_PERIOD)}>
                See all in the log
              </Link>
            </Button>
          ) : null}
        </div>
        {calls.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            This tool has not been called yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <ActionCallsTable
              rows={calls}
              showTool={false}
              detailHref={(r) =>
                logHref("/actions/log", { ...logView, call: r.id }, DEFAULT_PERIOD)
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
