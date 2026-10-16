import { getPublicBaseUrl } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { taskBriefsDocument } from "@/lib/gap-task";
import {
  attachTrend,
  filterByStatus,
  groupGaps,
  resolvePeriod,
  resolveSort,
  resolveStatus,
  sortGroups,
} from "@/lib/gaps";
import { type ExportFormat, exportFilename, toCsv, toDataset } from "@/lib/gaps-export";
import { loadGapRows } from "@/lib/gaps-query";
import { readGapsConfig } from "@/lib/gaps-signal";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Downloads of the gaps view (spec: gaps-export, gap-task-brief): the same
 * rows, period and order as the page, as a CSV for a docs team, as a
 * dataset the eval harness loads unchanged, or as one prompt per cluster
 * for a coding agent. A route handler rather than a server action
 * because a download link needs a URL. Dashboard-session gated exactly as
 * the page is — `getDefaultProject` sends a signed-out caller to login.
 */
export async function GET(request: Request) {
  const project = await getDefaultProject();
  const url = new URL(request.url);
  const format = resolveFormat(url.searchParams.get("format"));
  const now = new Date();
  const period = resolvePeriod(url.searchParams.get("period") ?? undefined, now);
  const sort = resolveSort(url.searchParams.get("sort") ?? undefined);
  const status = resolveStatus(url.searchParams.get("status") ?? undefined);
  const cfg = readGapsConfig();
  const db = getDb();

  const [rows, previousRows] = await Promise.all([
    loadGapRows(db, project, { from: period.from, to: null }, cfg),
    period.previousFrom && period.from
      ? loadGapRows(db, project, { from: period.previousFrom, to: period.from }, cfg)
      : Promise.resolve([]),
  ]);
  // The same pipeline as the page: trend first, then the status filter, then
  // the order (spec: gaps-status-filter).
  const groups = sortGroups(
    filterByStatus(
      attachTrend(groupGaps(rows, cfg), groupGaps(previousRows, cfg), period, now),
      status,
    ),
    sort,
  );

  const body =
    format === "csv"
      ? toCsv(groups)
      : format === "prompts"
        ? taskBriefsDocument(groups, {
            projectName: project.name,
            baseUrl: await getPublicBaseUrl(),
            period,
            now,
          })
        : `${JSON.stringify(toDataset(groups, { projectName: project.name, period, exportedAt: now, status }), null, 2)}\n`;
  return new Response(body, {
    headers: {
      "content-type": CONTENT_TYPE[format],
      "content-disposition": `attachment; filename="${exportFilename(format, project.name, period, now, status)}"`,
      "cache-control": "no-store",
    },
  });
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  dataset: "application/json; charset=utf-8",
  prompts: "text/markdown; charset=utf-8",
};

function resolveFormat(value: string | null): ExportFormat {
  return value === "dataset" || value === "prompts" ? value : "csv";
}
