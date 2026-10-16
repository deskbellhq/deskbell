import { actionServers } from "@deskbell/db";
import { ACTION_LIMITS } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SiteHeader } from "@/components/site-header";
import { identityIssuer } from "@/lib/actions/config";
import { requireMember } from "@/lib/auth/session";
import { originFromHeaders } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { ActionsTabs } from "./actions-tabs";
import { AttachServerDialog } from "./attach-server-dialog";

export const dynamic = "force-dynamic";

/**
 * The actions section (spec: actions-ia): one header, three tabs — the
 * tools, the servers they come from, the log of what ran — and the one
 * button that adds anything, because a tool only ever arrives by
 * attaching a server. Pages beneath render their own content only.
 */
export default async function ActionsLayout({ children }: { children: ReactNode }) {
  const [{ role }, project, h] = await Promise.all([
    requireMember(),
    getDefaultProject(),
    headers(),
  ]);
  const canEdit = role === "owner" || role === "admin";
  const count = await getDb().$count(
    actionServers,
    and(eq(actionServers.projectId, project.id), eq(actionServers.orgId, project.orgId)),
  );
  const jwksUrl = `${identityIssuer(originFromHeaders(h))}/api/v1/actions/jwks`;
  const canAttach = canEdit && count > 0 && count < ACTION_LIMITS.servers;

  return (
    <>
      <SiteHeader title="Actions" />
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <PageHeader
          title="Actions"
          description="What the widget can look up or do for a visitor through the MCP servers you attach, and what it did."
          actions={canAttach ? <AttachServerDialog jwksUrl={jwksUrl} /> : undefined}
        />
        <ActionsTabs />
        {children}
      </div>
    </>
  );
}
