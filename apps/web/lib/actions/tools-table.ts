import type { ServerView, ToolView } from "./settings";
import { type ToolUsage, type UsageMap, usageKey } from "./usage-query";

/**
 * The tools table (spec: actions-ia): one row per tool across every
 * attached server, in server order, lookups before actions within a
 * server. The unit is the tool because that is what an operator names,
 * switches and watches; the server is a line beneath it.
 */
export interface ToolTableRow {
  server: { id: string; name: string; slug: string; enabled: boolean };
  tool: ToolView;
  usage: ToolUsage | null;
}

export function toolTableRows(servers: ServerView[], usage: UsageMap): ToolTableRow[] {
  const rows: ToolTableRow[] = [];
  for (const server of servers) {
    const ordered = [...server.tools].sort((a, b) => Number(b.readOnly) - Number(a.readOnly));
    for (const tool of ordered) {
      rows.push({
        server: { id: server.id, name: server.name, slug: server.slug, enabled: server.enabled },
        tool,
        usage: usage.get(usageKey(server.id, tool.name)) ?? null,
      });
    }
  }
  return rows;
}

/** "3 of 5 on", or what is true instead. */
export function policyCount(rows: ToolTableRow[]): { on: number; total: number } {
  return {
    on: rows.filter((r) => r.tool.policy !== "off" && r.server.enabled).length,
    total: rows.length,
  };
}
