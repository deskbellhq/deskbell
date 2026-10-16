import { exportFilename, resolveId, resolveLogStatus, toCsv } from "@/lib/actions/log";
import { loadActionCalls } from "@/lib/actions/log-query";
import { getDb } from "@/lib/db";
import { resolvePeriod } from "@/lib/gaps";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * The actions log as a CSV (spec: actions-log): the same rows, period and
 * filters as the page. A route handler because a download needs a URL.
 * Dashboard-session gated exactly as the page is.
 */
export async function GET(request: Request) {
  const project = await getDefaultProject();
  const url = new URL(request.url);
  const now = new Date();
  const period = resolvePeriod(url.searchParams.get("period") ?? undefined, now);
  const view = {
    period: period.key,
    status: resolveLogStatus(url.searchParams.get("status") ?? undefined),
    server: resolveId(url.searchParams.get("server") ?? undefined),
    tool: resolveId(url.searchParams.get("tool") ?? undefined),
  };
  const rows = await loadActionCalls(getDb(), project, view, period.from);
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(view, now)}"`,
      "cache-control": "no-store",
    },
  });
}
