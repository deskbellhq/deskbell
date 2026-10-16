/**
 * Audits a question set's labels against an eval report (spec:
 * eval-label-audit).
 *
 * For every case that fell short of full recall it lists the labelled,
 * cited and retrieved documents side by side, with whether each one contains
 * the case's marking criteria as text. The output is evidence for a person
 * relabelling; nothing here edits the dataset.
 *
 * Needs the corpus the report ran against — `DATABASE_URL` selects it, as for
 * a `--project` run — and a report produced by a harness that records
 * `retrievedDocumentIds`; older reports still audit, with the retrieved column
 * empty.
 *
 * Usage:
 *   pnpm exec tsx scripts/eval-label-audit.ts \
 *     --report packages/evals/reports/x.json \
 *     --dataset packages/evals/datasets/private/x.json \
 *     [--project proj_x] [--markdown packages/evals/reports/x-label-audit.md]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadDataset } from "../packages/evals/src/dataset";
import type { EvalReport } from "../packages/evals/src/types";

const { values } = parseArgs({
  options: {
    report: { type: "string" },
    dataset: { type: "string" },
    project: { type: "string" },
    markdown: { type: "string" },
  },
});

if (!values.report || !values.dataset) {
  console.error(
    "usage: tsx scripts/eval-label-audit.ts --report <json> --dataset <json> [--project <id>] [--markdown <out>]",
  );
  process.exit(2);
}

const reportPath = resolve(values.report);
const datasetPath = resolve(values.dataset);

async function main() {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as EvalReport;
  const dataset = await loadDataset(datasetPath);

  const projectId = values.project ?? report.target.replace(/^project:/, "");
  if (projectId === report.target) {
    throw new Error(`report target "${report.target}" is not a project run; pass --project`);
  }

  // Lazy, like the project target: this is the only path that opens a database.
  const { auditLabels, createDb, documentIdsInvolved, loadAuditCorpus, renderLabelAudit } =
    await import("../packages/evals/src/audit");

  const db = createDb();
  try {
    const corpus = await loadAuditCorpus(db, projectId, (idByUrl) =>
      documentIdsInvolved(report, dataset, { byId: new Map(), idByUrl }),
    );
    const audited = auditLabels(report, dataset, corpus);
    const markdown = renderLabelAudit(audited, report.k);

    if (values.markdown) {
      const out = resolve(values.markdown);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, markdown);
      console.error(`wrote ${out}`);
    } else {
      process.stdout.write(markdown);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
