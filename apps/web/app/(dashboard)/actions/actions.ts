"use server";

import { actionServers } from "@deskbell/db";
import { ACTION_LIMITS, type ActionPolicy, newId, suggestedPolicy } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { discoverActionServer } from "@/lib/actions/mcp";
import { mergeLabels, mergePolicies, mergeServerSettings } from "@/lib/actions/settings";
import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Actions settings (spec: mcp-actions, actions-settings-ui): the MCP servers
 * a project attaches and what each of their tools may do. Admin-gated like
 * the allowlist and the identity settings: a server credential is
 * bearer-equivalent, and a tool policy decides what runs on a visitor's
 * behalf. The merges are pure and unit-tested; this file reads forms and
 * writes rows. A policy change is one call per tool, so the page can save
 * a switch the moment it is flipped.
 */

export interface ServerFormState {
  error?: string;
  saved?: boolean;
  /** Set when the save also refreshed the tool list. */
  discovered?: number;
  /** Refresh failed after a successful save; the row says why. */
  discoveryError?: string;
}

const PATH = "/actions";

function revalidate(serverId?: string) {
  revalidatePath(PATH);
  revalidatePath(`${PATH}/servers`);
  if (serverId) revalidatePath(`${PATH}/servers/${serverId}`);
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function ownRow(id: string) {
  const project = await getDefaultProject();
  const row = await getDb().query.actionServers.findFirst({
    where: and(
      eq(actionServers.id, id),
      eq(actionServers.projectId, project.id),
      eq(actionServers.orgId, project.orgId),
    ),
  });
  return { project, row };
}

/**
 * Discover the server's tools and record the outcome on the row. A failure
 * is stored, never thrown: the settings page shows "unreachable" with the
 * reason, and the tools last seen stay in place. A server that only answers
 * to a visitor's token is listed with one the operator pasted for this call
 * (spec: visitor-token-actions); it is used once and not kept.
 */
async function refresh(
  id: string,
  discoveryToken?: string,
): Promise<{ tools?: number; error?: string }> {
  const { row } = await ownRow(id);
  if (!row) return { error: "Unknown server" };
  const db = getDb();
  try {
    const discovery = await discoverActionServer(
      row,
      discoveryToken ? { bearerToken: discoveryToken } : {},
    );
    await db
      .update(actionServers)
      .set({
        tools: discovery.tools,
        toolsFetchedAt: new Date(),
        serverInfo: discovery.serverInfo,
        initializeResult: discovery.initializeResult,
        status: "ok",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(actionServers.id, id));
    return { tools: discovery.tools.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(actionServers)
      .set({ status: "unreachable", lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(actionServers.id, id));
    return { error: message };
  }
}

export async function saveServer(
  _prev: ServerFormState | undefined,
  formData: FormData,
): Promise<ServerFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const project = await getDefaultProject();
  const db = getDb();
  const id = field(formData, "serverId");
  const stored = id
    ? await db.query.actionServers.findFirst({
        where: and(
          eq(actionServers.id, id),
          eq(actionServers.projectId, project.id),
          eq(actionServers.orgId, project.orgId),
        ),
      })
    : undefined;
  if (id && !stored) return { error: "Unknown server" };

  const merged = mergeServerSettings(stored ?? null, {
    name: field(formData, "name"),
    slug: field(formData, "slug"),
    url: field(formData, "url"),
    transport: field(formData, "transport"),
    authKind: field(formData, "authKind"),
    authHeaderName: field(formData, "authHeaderName"),
    authSecret: field(formData, "authSecret"),
    identity: field(formData, "identity"),
    exchangeClientId: field(formData, "exchangeClientId"),
    exchangeClientSecret: field(formData, "exchangeClientSecret"),
    exchangeAudience: field(formData, "exchangeAudience"),
    exchangeScope: field(formData, "exchangeScope"),
    // The switch lives in the server page's header, not in this form; a
    // save must never re-enable a server someone switched off.
    enabled: stored ? stored.enabled : true,
  });
  if (!merged.ok) return { error: merged.error };
  // Optional config absent from the form clears the column, so a mode
  // switched away from leaves nothing behind.
  const columns = {
    ...merged.server,
    authHeaderName: merged.server.authHeaderName ?? null,
    exchangeClientId: merged.server.exchangeClientId ?? null,
    exchangeAudience: merged.server.exchangeAudience ?? null,
    exchangeScope: merged.server.exchangeScope ?? null,
  };

  const clash = await db.query.actionServers.findFirst({
    where: and(eq(actionServers.projectId, project.id), eq(actionServers.slug, merged.server.slug)),
    columns: { id: true },
  });
  if (clash && clash.id !== stored?.id) {
    return { error: `Another server already uses the id "${merged.server.slug}".` };
  }

  let serverId = stored?.id;
  if (stored) {
    await db
      .update(actionServers)
      .set({ ...columns, updatedAt: new Date() })
      .where(eq(actionServers.id, stored.id));
  } else {
    const count = await db.$count(
      actionServers,
      and(eq(actionServers.projectId, project.id), eq(actionServers.orgId, project.orgId)),
    );
    if (count >= ACTION_LIMITS.servers) {
      return { error: `A project can attach up to ${ACTION_LIMITS.servers} servers.` };
    }
    serverId = newId("srv");
    await db.insert(actionServers).values({
      id: serverId,
      orgId: project.orgId,
      projectId: project.id,
      ...columns,
    });
  }
  // A saved server is immediately asked for its tools: one click, not two.
  // The attach dialog may carry a one-time token for a server that needs one.
  const outcome = serverId
    ? await refresh(serverId, field(formData, "discoveryToken") || undefined)
    : {};
  revalidate(serverId);
  // A fresh attach lands on the server's page, where the tools just found
  // wait for a policy. Done here rather than in the dialog: the list
  // re-renders on revalidation and the dialog that submitted may be gone.
  if (!stored && serverId) redirect(`${PATH}/servers/${serverId}`);
  return {
    saved: true,
    ...(outcome.tools !== undefined ? { discovered: outcome.tools } : {}),
    ...(outcome.error ? { discoveryError: outcome.error } : {}),
  };
}

export async function refreshTools(
  id: string,
  discoveryToken?: string,
): Promise<{ tools?: number; error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const outcome = await refresh(id, discoveryToken?.trim() || undefined);
  revalidate(id);
  return outcome;
}

export async function setServerEnabled(id: string, enabled: boolean): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const { row } = await ownRow(id);
  if (!row) return { error: "Unknown server" };
  await getDb()
    .update(actionServers)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(actionServers.id, row.id));
  revalidate(id);
  return {};
}

export async function deleteServer(id: string): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const { project } = await ownRow(id);
  await getDb()
    .delete(actionServers)
    .where(
      and(
        eq(actionServers.id, id),
        eq(actionServers.projectId, project.id),
        eq(actionServers.orgId, project.orgId),
      ),
    );
  revalidate(id);
  return {};
}

/**
 * One tool's policy, saved as soon as it is chosen. The whole map goes
 * through the same merge as a full save, so a tool the server no longer
 * lists is still dropped and an unknown name cannot gain a policy.
 */
export async function setPolicy(
  id: string,
  tool: string,
  policy: ActionPolicy,
): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const { row } = await ownRow(id);
  if (!row) return { error: "Unknown server" };
  const tools = row.tools ?? [];
  if (!tools.some((t) => t.name === tool))
    return { error: "The server no longer lists this tool." };
  const values: Record<string, string> = { ...row.policies, [tool]: policy };
  await getDb()
    .update(actionServers)
    .set({ policies: mergePolicies(tools, values), updatedAt: new Date() })
    .where(eq(actionServers.id, row.id));
  revalidate(id);
  return {};
}

/**
 * One tool's visitor-facing label (spec: action-presentation), saved when
 * the field is left. Blank returns the tool to its own title. The whole map
 * goes through `mergeLabels`, so vanished tools are dropped here too.
 */
export async function setLabel(
  id: string,
  tool: string,
  label: string,
): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const { row } = await ownRow(id);
  if (!row) return { error: "Unknown server" };
  const tools = row.tools ?? [];
  if (!tools.some((t) => t.name === tool))
    return { error: "The server no longer lists this tool." };
  const values: Record<string, string> = { ...row.labels, [tool]: label };
  await getDb()
    .update(actionServers)
    .set({ labels: mergeLabels(tools, values), updatedAt: new Date() })
    .where(eq(actionServers.id, row.id));
  revalidate(id);
  return {};
}

/** Every tool to its suggested policy: allowed when read-only, confirmation otherwise. */
export async function applySuggestedPolicies(id: string): Promise<{ error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const { row } = await ownRow(id);
  if (!row) return { error: "Unknown server" };
  const tools = row.tools ?? [];
  const values: Record<string, string> = {};
  for (const tool of tools) values[tool.name] = suggestedPolicy(tool);
  await getDb()
    .update(actionServers)
    .set({ policies: mergePolicies(tools, values), updatedAt: new Date() })
    .where(eq(actionServers.id, row.id));
  revalidate(id);
  return {};
}
