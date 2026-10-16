import { actionServers } from "@deskbell/db";
import { Badge } from "@deskbell/ui/components/badge";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { identityIssuer } from "@/lib/actions/config";
import { serverView } from "@/lib/actions/settings";
import { requireMember } from "@/lib/auth/session";
import { originFromHeaders } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { statusOf } from "../../server-list";
import { ConnectionForm } from "./connection-form";
import { ServerHeaderActions } from "./server-header";
import { ToolsList } from "./tools-list";

export const dynamic = "force-dynamic";

/**
 * One server's page (spec: actions-settings-ui): its tools first, because
 * a policy is what an operator comes here to change, then the connection.
 * Scoped to the project like every other read (D12); a foreign id is a 404,
 * never a hint that the row exists.
 */
export default async function ServerPage({ params }: { params: Promise<{ serverId: string }> }) {
  const [{ serverId }, { role }, project, h] = await Promise.all([
    params,
    requireMember(),
    getDefaultProject(),
    headers(),
  ]);
  const canEdit = role === "owner" || role === "admin";
  const row = await getDb().query.actionServers.findFirst({
    where: and(
      eq(actionServers.id, serverId),
      eq(actionServers.projectId, project.id),
      eq(actionServers.orgId, project.orgId),
    ),
  });
  if (!row) notFound();
  const server = serverView(row);
  const status = statusOf(server);
  const jwksUrl = `${identityIssuer(originFromHeaders(h))}/api/v1/actions/jwks`;
  const info = server.serverInfo;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8" data-testid={`server-${server.slug}`}>
      <div className="flex flex-col gap-4">
        <Link
          href="/actions/servers"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Servers
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-pretty break-words">
                {server.name}
              </h1>
              <Badge
                variant={status.tone === "bad" ? "destructive" : "outline"}
                className={
                  status.tone === "ok"
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                    : undefined
                }
                title={status.tone === "bad" ? (server.lastError ?? undefined) : undefined}
              >
                {status.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground break-all">
              <span className="font-mono">{server.slug}</span>
              {" · "}
              {server.url}
              {info ? ` · ${info.title ?? info.name} ${info.version}` : ""}
            </p>
          </div>
          {canEdit ? (
            <ServerHeaderActions
              server={{
                id: server.id,
                name: server.name,
                enabled: server.enabled,
                toolCount: server.tools.length,
                needsDiscoveryToken: server.identity === "visitor",
              }}
            />
          ) : null}
        </div>
        {status.tone === "bad" && server.lastError ? (
          <p className="text-sm text-destructive" role="status">
            Could not reach the server: {server.lastError}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Tools</h2>
            <p className="text-sm text-muted-foreground">
              What the server offers, with the exact description the model reads. The label is what
              the visitor sees while a tool runs and on its confirmation card; blank uses the tool's
              title. Changes apply to the next question.
            </p>
          </div>
          {server.toolsFetchedAt ? (
            <p className="text-xs text-muted-foreground">
              Refreshed {new Date(server.toolsFetchedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        {!server.enabled ? (
          <p className="text-sm text-muted-foreground" role="status">
            This server is off. Its policies are kept, but none of its tools are offered.
          </p>
        ) : null}
        <ToolsList
          serverId={server.id}
          tools={server.tools}
          lastError={server.lastError}
          canEdit={canEdit}
        />
      </section>

      <section className="flex flex-col gap-4 border-t pt-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Connection</h2>
          <p className="text-sm text-muted-foreground">
            Saving reconnects and refreshes the tool list. The credential is stored on this instance
            and shown masked.
          </p>
        </div>
        <ConnectionForm server={server} canEdit={canEdit} jwksUrl={jwksUrl} />
      </section>
    </div>
  );
}
