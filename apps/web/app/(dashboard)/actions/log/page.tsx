import { Button } from "@deskbell/ui/components/button";
import Link from "next/link";

import { ActionCallDetail } from "@/components/action-call-detail";
import { ActionCallsTable } from "@/components/action-calls-table";
import { ActionsLogToolbar } from "@/components/actions-log-toolbar";
import { type LogView, logHref, resolveId, resolveLogStatus } from "@/lib/actions/log";
import {
  LOG_LIMIT,
  loadActionCall,
  loadActionCalls,
  loadServerOptions,
} from "@/lib/actions/log-query";
import { getDb } from "@/lib/db";
import { resolvePeriod } from "@/lib/gaps";
import { DEFAULT_PERIOD } from "@/lib/gaps-view";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

const PATH = "/actions/log";

/**
 * The actions log (spec: actions-log): every tool call the project made,
 * newest first, with the visitor's question beside it and a drawer for the
 * full record. The view is the URL; the export takes the same one.
 */
export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    status?: string | string[];
    server?: string | string[];
    tool?: string | string[];
    call?: string | string[];
  }>;
}) {
  const [project, params] = await Promise.all([getDefaultProject(), searchParams]);
  const now = new Date();
  const period = resolvePeriod(params.period, now);
  const view: LogView = {
    period: period.key,
    status: resolveLogStatus(params.status),
    server: resolveId(params.server),
    tool: resolveId(params.tool),
    call: resolveId(params.call),
  };
  const db = getDb();
  const [rows, servers, selected] = await Promise.all([
    loadActionCalls(db, project, view, period.from),
    loadServerOptions(db, project),
    view.call ? loadActionCall(db, project, view.call) : Promise.resolve(null),
  ]);
  const href = (next: Partial<LogView>) => logHref(PATH, { ...view, ...next }, DEFAULT_PERIOD);
  const filtered = view.status !== "all" || view.server || view.tool;

  return (
    <div className="flex flex-col gap-4">
      <ActionsLogToolbar view={view} servers={servers} />
      {rows.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          {servers.length === 0 ? (
            <>
              <p>No actions yet.</p>
              <p className="mt-1">
                <Link href="/actions/servers" className="underline underline-offset-4">
                  Attach an MCP server
                </Link>{" "}
                and switch a tool on; every call it makes lands here.
              </p>
            </>
          ) : filtered ? (
            <>
              <p>No calls match these filters.</p>
              <Button variant="link" size="sm" asChild>
                <Link href={href({ status: "all", server: null, tool: null })}>Clear filters</Link>
              </Button>
            </>
          ) : (
            <p>No calls in this period.</p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <ActionCallsTable rows={rows} detailHref={(r) => href({ call: r.id })} />
          {rows.length >= LOG_LIMIT ? (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing the latest {LOG_LIMIT} calls. Narrow the period or download the CSV for the
              rest.
            </p>
          ) : null}
        </div>
      )}
      {selected ? (
        <ActionCallDetail key={selected.id} call={selected} closeHref={href({ call: null })} />
      ) : null}
    </div>
  );
}
