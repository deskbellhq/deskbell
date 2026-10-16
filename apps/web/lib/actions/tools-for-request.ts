import type { EngineTool } from "@deskbell/core";
import { actionServers, type Database } from "@deskbell/db";
import {
  actionToolDescription,
  actionToolName,
  actionVisitorLabel,
  identityRequired,
  policyFor,
} from "@deskbell/shared";
import { and, eq } from "drizzle-orm";

import type { EndUser } from "../identity/end-users";
import { getSigningKey, mintIdentityToken } from "./identity-token";
import { type ActionServerRow, connectActionServer, normalizeToolResult } from "./mcp";
import { exchangeVisitorToken } from "./token-exchange";

/**
 * The tools one request may use (spec: mcp-actions): every enabled server of
 * the project, every tool whose policy is not off. A server that wants the
 * visitor's identity is skipped for an anonymous session — no identity, no
 * scoped tools (D16). Clients are created lazily, on the first call to a
 * server, and closed together when the request is done; so is the token
 * exchange a `visitor` server needs (spec: visitor-token-actions), which
 * means a turn that calls no tool never talks to the identity provider.
 */

export interface RequestTools {
  tools: EngineTool[];
  /** Which server a namespaced tool belongs to, for the audit row. */
  serverOf: (toolName: string) => ActionServerRow | undefined;
  close: () => Promise<void>;
}

export interface RequestToolsInput {
  db: Database;
  project: { id: string; orgId: string };
  endUser: EndUser | null;
  /**
   * The bearer the widget sent on this request, present only when the guard
   * verified it as `endUser`. Lives for this request and is never stored.
   */
  visitorToken?: string | null;
  conversationId: string;
  /** This instance's public URL, the identity token's issuer. */
  issuer: string;
  fetch?: typeof fetch;
}

/** The bearer a `visitor` server receives: exchanged when a client is configured, else as sent. */
async function visitorBearer(
  server: ActionServerRow,
  input: RequestToolsInput,
  token: string,
  endUser: EndUser,
): Promise<string> {
  if (!server.exchangeClientId) return token;
  if (!server.exchangeClientSecret) {
    throw new Error(`Server ${server.slug}: the exchange client has no secret`);
  }
  return exchangeVisitorToken(
    {
      issuer: endUser.issuer,
      subjectToken: token,
      client: {
        clientId: server.exchangeClientId,
        clientSecret: server.exchangeClientSecret,
        audience: server.exchangeAudience,
        scope: server.exchangeScope,
      },
    },
    input.fetch ? { fetch: input.fetch } : {},
  );
}

export async function toolsForRequest(input: RequestToolsInput): Promise<RequestTools> {
  const rows = await input.db
    .select()
    .from(actionServers)
    .where(
      and(
        eq(actionServers.projectId, input.project.id),
        eq(actionServers.orgId, input.project.orgId),
        eq(actionServers.enabled, true),
      ),
    );
  const clients = new Map<string, Promise<Awaited<ReturnType<typeof connectActionServer>>>>();
  const byTool = new Map<string, ActionServerRow>();
  const tools: EngineTool[] = [];

  const clientFor = (server: ActionServerRow) => {
    let client = clients.get(server.id);
    if (!client) {
      client = (async () => {
        const identityToken =
          server.identity === "signed" && input.endUser
            ? await mintIdentityToken(await getSigningKey(input.db), {
                issuer: input.issuer,
                audience: server.slug,
                visitor: input.endUser,
                projectId: input.project.id,
                conversationId: input.conversationId,
              })
            : undefined;
        const bearerToken =
          server.identity === "visitor" && input.endUser && input.visitorToken
            ? await visitorBearer(server, input, input.visitorToken, input.endUser)
            : undefined;
        return connectActionServer(server, {
          identityToken,
          bearerToken,
          ...(input.fetch ? { fetch: input.fetch } : {}),
        });
      })();
      clients.set(server.id, client);
    }
    return client;
  };

  for (const server of rows) {
    if (identityRequired(server.identity) && !input.endUser) continue;
    // A verified visitor without the token in hand cannot be represented to
    // a `visitor` server; the route always passes both, this guards the pair.
    if (server.identity === "visitor" && !input.visitorToken) continue;
    for (const tool of server.tools ?? []) {
      const policy = policyFor(server.policies, tool.name);
      if (policy === "off") continue;
      const name = actionToolName(server.slug, tool.name);
      byTool.set(name, server);
      tools.push({
        name,
        title: actionVisitorLabel(tool, server.labels),
        description: actionToolDescription(tool),
        inputSchema: tool.inputSchema,
        policy,
        readOnly: tool.annotations?.readOnlyHint === true,
        execute: async (args, { signal }) => {
          const client = await clientFor(server);
          const result = await client.callTool({
            name: tool.name,
            arguments:
              args && typeof args === "object" && !Array.isArray(args)
                ? (args as Record<string, unknown>)
                : {},
            options: { signal },
          });
          const normalized = normalizeToolResult(result);
          if (normalized.error) throw new Error(normalized.error);
          return normalized.output;
        },
      });
    }
  }

  return {
    tools,
    serverOf: (name) => byTool.get(name),
    close: async () => {
      await Promise.all(
        [...clients.values()].map((c) => c.then((client) => client.close()).catch(() => {})),
      );
    },
  };
}
