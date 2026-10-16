import { actionServers } from "@deskbell/db";
import { ACTION_LIMITS } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { identityIssuer } from "@/lib/actions/config";
import { serverView } from "@/lib/actions/settings";
import { requireMember } from "@/lib/auth/session";
import { originFromHeaders } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { AttachServerDialog } from "../attach-server-dialog";
import { EmptyState } from "../empty-state";
import { ServerList } from "../server-list";

export const dynamic = "force-dynamic";

/**
 * Servers — the MCP servers a project attaches (spec: mcp-actions,
 * actions-settings-ui, actions-ia). This page is the list; each server has
 * a page of its own with its tools and connection. The client only ever
 * sees the view with credentials masked.
 */
export default async function ServersPage() {
  const [{ role }, project, h] = await Promise.all([
    requireMember(),
    getDefaultProject(),
    headers(),
  ]);
  const canEdit = role === "owner" || role === "admin";
  const rows = await getDb()
    .select()
    .from(actionServers)
    .where(and(eq(actionServers.projectId, project.id), eq(actionServers.orgId, project.orgId)))
    .orderBy(actionServers.createdAt);
  const servers = rows.map(serverView);
  const jwksUrl = `${identityIssuer(originFromHeaders(h))}/api/v1/actions/jwks`;
  const canAttach = canEdit && servers.length < ACTION_LIMITS.servers;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      {servers.length === 0 ? (
        <EmptyState action={canAttach ? <AttachServerDialog jwksUrl={jwksUrl} /> : undefined} />
      ) : (
        <ServerList servers={servers} />
      )}
      {!canEdit ? (
        <p className="text-sm text-muted-foreground">Only admins can change actions.</p>
      ) : null}
    </div>
  );
}
