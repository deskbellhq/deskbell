import { actionServers } from "@deskbell/db";
import { ACTION_LIMITS } from "@deskbell/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";

import { identityIssuer } from "@/lib/actions/config";
import { serverView } from "@/lib/actions/settings";
import { policyCount, toolTableRows } from "@/lib/actions/tools-table";
import { loadToolUsage } from "@/lib/actions/usage-query";
import { requireMember } from "@/lib/auth/session";
import { originFromHeaders } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/inbox";
import { formatLatency } from "@/lib/latency";
import { getDefaultProject } from "@/lib/org";

import { AttachServerDialog } from "./attach-server-dialog";
import { EmptyState } from "./empty-state";
import { HintBadges, PolicyControl } from "./tool-fields";

export const dynamic = "force-dynamic";

const USAGE_DAYS = 30;

/**
 * The tools (spec: actions-ia): one row per tool across every attached
 * server — what the visitor sees it called, what the model is told, which
 * server it comes from, whether it is on, and what the last thirty days
 * say about it. The policy saves from here; the tool's page has the rest.
 */
export default async function ToolsPage() {
  const [{ role }, project, h] = await Promise.all([
    requireMember(),
    getDefaultProject(),
    headers(),
  ]);
  const canEdit = role === "owner" || role === "admin";
  const db = getDb();
  const from = new Date(Date.now() - USAGE_DAYS * 86_400_000);
  const [serverRows, usage] = await Promise.all([
    db
      .select()
      .from(actionServers)
      .where(and(eq(actionServers.projectId, project.id), eq(actionServers.orgId, project.orgId)))
      .orderBy(actionServers.createdAt),
    loadToolUsage(db, project, from),
  ]);
  const servers = serverRows.map(serverView);
  const rows = toolTableRows(servers, usage);
  const { on, total } = policyCount(rows);
  const jwksUrl = `${identityIssuer(originFromHeaders(h))}/api/v1/actions/jwks`;

  if (servers.length === 0) {
    const canAttach = canEdit && servers.length < ACTION_LIMITS.servers;
    return <EmptyState action={canAttach ? <AttachServerDialog jwksUrl={jwksUrl} /> : undefined} />;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
        <p>No tools listed yet.</p>
        <p className="mt-1">
          The attached servers offered none, or could not be reached.{" "}
          <Link href="/actions/servers" className="underline underline-offset-4">
            Check the servers
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {on} of {total} {total === 1 ? "tool" : "tools"} on · usage over the last {USAGE_DAYS} days
        {!canEdit ? " · only admins can change a policy" : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead>Last used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ server, tool, usage }) => (
              <TableRow
                key={`${server.id}/${tool.name}`}
                data-testid={`tool-${server.slug}-${tool.name}`}
                className={server.enabled ? undefined : "opacity-60"}
              >
                <TableCell className="max-w-md align-top">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/actions/${server.id}/${encodeURIComponent(tool.name)}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {tool.label || tool.title}
                    </Link>
                    <HintBadges tool={tool} />
                  </div>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={tool.description || undefined}
                  >
                    {tool.description || <em>No description</em>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Link
                      href={`/actions/servers/${server.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {server.name}
                    </Link>
                    {" · "}
                    <code>{tool.name}</code>
                    {!server.enabled ? " · server off" : ""}
                  </p>
                </TableCell>
                <TableCell className="align-top whitespace-nowrap">
                  <PolicyControl
                    serverId={server.id}
                    tool={tool}
                    policy={tool.policy}
                    canEdit={canEdit}
                    showSuggestion={false}
                  />
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {usage ? usage.calls : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {usage?.failed ? (
                    <span className="text-destructive">{usage.failed}</span>
                  ) : usage ? (
                    "0"
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {usage?.medianMs != null ? (
                    formatLatency(usage.medianMs)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                  {usage?.lastAt ? (
                    <span title={usage.lastAt.toLocaleString()}>{relativeTime(usage.lastAt)}</span>
                  ) : (
                    "Never"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
