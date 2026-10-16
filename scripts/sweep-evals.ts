/**
 * Runs the eval harness once per retrieval configuration and files the
 * reports side by side (spec: hybrid-retrieval, open questions).
 *
 * Deliberately dumb: each configuration is one `run-evals.ts` invocation with
 * a label, sequential so runs never contend for the model or the database.
 * Reports land in `packages/evals/reports/sweep/` (gitignored — a sweep
 * against a private dataset writes every question and answer verbatim).
 * Reading the numbers side by side is the human's job; nothing here declares
 * a winner.
 *
 * Retrieval-only by DEFAULT: recall@k, precision@k, MRR and nDCG@k depend on
 * nothing that happens after retrieval, so generating an answer per case per
 * configuration is paying for output nobody reads. Pass `--judge` to answer and
 * grade as well — and read those numbers knowing that a single run's Factuality
 * moves case to case on its own, while the retrieval numbers do not.
 *
 * Usage:
 *   pnpm sweep --project proj_dev --dataset packages/evals/datasets/private/x.json
 *   pnpm sweep --project proj_dev --dataset ... --configs my-sweep.json --judge llm
 *
 * A configs file is a JSON array of { label, args } entries, where args are
 * extra run-evals flags, e.g.
 *   [{ "label": "hybrid-d80", "args": ["--retrieval-mode", "hybrid", "--leg-depth", "80"] }]
 * Without one, the default matrix below covers the spec's first sweep
 * questions: each mechanism alone against the shipped baseline.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

interface SweepConfig {
  label: string;
  args: string[];
}

const DEFAULT_MATRIX: SweepConfig[] = [
  { label: "baseline", args: [] },
  { label: "hybrid", args: ["--retrieval-mode", "hybrid"] },
  { label: "multi-query", args: ["--multi-query"] },
  { label: "hybrid-multi", args: ["--retrieval-mode", "hybrid", "--multi-query"] },
  {
    label: "hybrid-multi-cap2",
    args: ["--retrieval-mode", "hybrid", "--multi-query", "--max-per-doc", "2"],
  },
  {
    label: "hybrid-multi-cosine",
    args: ["--retrieval-mode", "hybrid", "--multi-query", "--order", "cosine"],
  },
  {
    label: "hybrid-multi-rerank-llm",
    args: ["--retrieval-mode", "hybrid", "--multi-query", "--rerank", "llm"],
  },
  {
    label: "hybrid-multi-rerank-local",
    args: ["--retrieval-mode", "hybrid", "--multi-query", "--rerank", "local"],
  },
];

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    dataset: { type: "string" },
    judge: { type: "string" },
    configs: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.project || !values.dataset) {
  console.error(
    "usage: pnpm sweep --project <id> --dataset <path> [--judge llm] [--configs f.json]",
  );
  process.exit(2);
}

const configs: SweepConfig[] = values.configs
  ? (JSON.parse(readFileSync(resolve(values.configs), "utf8")) as SweepConfig[])
  : DEFAULT_MATRIX;

const datasetSlug = basename(values.dataset).replace(/\.json$/, "");
const outDir = new URL("../packages/evals/reports/sweep/", import.meta.url).pathname;

const summaries: string[] = [];
for (const config of configs) {
  const out = `${outDir}${datasetSlug}-${config.label}`;
  const args = [
    "scripts/run-evals.ts",
    "--project",
    values.project,
    "--dataset",
    values.dataset,
    ...(values.judge ? ["--judge", values.judge] : ["--retrieval-only"]),
    ...config.args,
    "--json",
    `${out}.json`,
    "--markdown",
    `${out}.md`,
  ];
  console.error(`\n=== ${config.label}: run-evals ${config.args.join(" ")}`);
  if (values["dry-run"]) continue;
  const result = spawnSync("pnpm", ["exec", "tsx", ...args], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (result.status !== 0) {
    console.error(`${config.label}: run failed (exit ${result.status}) — stopping the sweep`);
    process.exit(result.status ?? 1);
  }
  try {
    const report = JSON.parse(readFileSync(`${out}.json`, "utf8")) as {
      factuality: number | null;
      uncertainty: number | null;
      falseRefusalRate: number | null;
      retrieval: {
        recallAtK: number;
        precisionAtK: number;
        mrr: number;
        ndcgAtK: number;
      } | null;
      cost: { medianLatencyMs: number; p95LatencyMs: number };
    };
    const f = (n: number | null | undefined) =>
      n === null || n === undefined ? "—" : n.toFixed(3);
    const retrieval = `recall@k ${f(report.retrieval?.recallAtK)}  prec@k ${f(
      report.retrieval?.precisionAtK,
    )}  mrr ${f(report.retrieval?.mrr)}  ndcg ${f(report.retrieval?.ndcgAtK)}`;
    // Quality columns only when something graded. Printing "fact —" in every
    // row invites reading the dash as a score; printing a real one from a
    // single run invites comparing numbers that move on their own.
    const quality = values.judge
      ? `  fact ${f(report.factuality)}  falseRef ${f(report.falseRefusalRate)}`
      : "";
    summaries.push(
      `${config.label.padEnd(22)} ${retrieval}${quality}  p50 ${report.cost.medianLatencyMs}ms  p95 ${report.cost.p95LatencyMs}ms`,
    );
  } catch {
    summaries.push(`${config.label}: report unreadable`);
  }
}

console.error(`\n=== sweep summary (${datasetSlug})`);
for (const line of summaries) console.error(line);
if (values.judge) {
  console.error(
    "\nFactuality here is one run per configuration. Individual cases flip between " +
      "identical runs of a real model, so read a small difference as noise until it " +
      "survives a repeat.",
  );
}
console.error(`\nfull reports: ${outDir}`);
