/**
 * Sorts an eval report's retrieval misses by what kind of miss they are
 * (spec: contextual-chunks — the diagnostic that decides what to try next).
 *
 * For every labelled document that did not reach the top-k it reports how
 * many of the question's content words appear anywhere in that document,
 * which of them are missing, and how the retrieved documents compare — so a
 * person can tell a lexical miss (the page never uses the asker's words; a
 * vocabulary or a rewrite could bridge it) from a ranking loss (the words
 * are there and the page still lost; only the embedding input or the
 * ordering can move it). Word overlap alone does not separate the two — the
 * hits' median is printed beside the misses' so the reader can see that —
 * which is why the output is evidence, not a verdict.
 *
 * Needs the corpus the report ran against (`DATABASE_URL`) and a report that
 * records `retrievedDocumentIds`.
 *
 * Usage:
 *   pnpm exec tsx scripts/eval-miss-classify.ts \
 *     --report packages/evals/reports/x.json \
 *     --dataset packages/evals/datasets/private/x.json [--project proj_x]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadDataset } from "../packages/evals/src/dataset";
import type { EvalReport } from "../packages/evals/src/types";

const { values } = parseArgs({
  options: {
    report: { type: "string" },
    dataset: { type: "string" },
    project: { type: "string" },
  },
});

if (!values.report || !values.dataset) {
  console.error(
    "usage: tsx scripts/eval-miss-classify.ts --report <json> --dataset <json> [--project <id>]",
  );
  process.exit(2);
}

const STOP = new Set(
  (
    "a an the and or of to in on for with at by from as is are be was were do does did how what " +
    "which who where when why can could would should i we you our your my it its this that these " +
    "those there their them they into via using use get set up out if then than so any all some " +
    "not no yes one two way ways it's we're i'm want need like have has had will just also about " +
    "only more most other such etc"
  ).split(" "),
);

/** Lowercased content words with a light stem — enough to match "methods" to "method". */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? []) {
    if (STOP.has(raw) || raw.length < 3) continue;
    let t = raw.replace(/ies$/, "y").replace(/(sses|xes|ches|shes)$/, (m) => m.slice(0, -2));
    t = t.replace(/(?<!s)s$/, "");
    if (t.length > 5) t = t.replace(/(ing|ed)$/, "");
    out.add(t);
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

async function main() {
  const report = JSON.parse(readFileSync(resolve(values.report as string), "utf8")) as EvalReport;
  const dataset = await loadDataset(resolve(values.dataset as string));
  const projectId = values.project ?? report.target.replace(/^project:/, "");
  if (projectId === report.target) {
    throw new Error(`report target "${report.target}" is not a project run; pass --project`);
  }

  const { createDb, documentIdsInvolved, labelIds, loadAuditCorpus } = await import(
    "../packages/evals/src/audit"
  );
  const db = createDb();
  try {
    const corpus = await loadAuditCorpus(db, projectId, (idByUrl) =>
      documentIdsInvolved(report, dataset, { byId: new Map(), idByUrl }),
    );
    const byCase = new Map(dataset.cases.map((c) => [c.id, c]));
    const words = new Map<string, Set<string>>();
    const docWords = (id: string) => {
      let w = words.get(id);
      if (!w) {
        w = contentWords(corpus.byId.get(id)?.chunks.join(" ") ?? "");
        words.set(id, w);
      }
      return w;
    };

    type Row = {
      caseId: string;
      question: string;
      hit: boolean;
      title: string;
      chunks: number;
      coverage: number;
      present: string[];
      missing: string[];
      bestRetrievedCoverage: number;
      retrievedTitles: string[];
      tags: string[];
    };
    const rows: Row[] = [];
    for (const result of report.cases) {
      const evalCase = byCase.get(result.id);
      if (!evalCase || !result.retrievedDocumentIds) continue;
      const labels = labelIds(evalCase, corpus);
      if (labels.length === 0) continue;
      const q = contentWords(result.question);
      const top = result.retrievedDocumentIds.slice(0, report.k);
      for (const id of labels) {
        const doc = corpus.byId.get(id);
        if (!doc) continue;
        const dw = docWords(id);
        const present = [...q].filter((w) => dw.has(w)).sort();
        const missing = [...q].filter((w) => !dw.has(w)).sort();
        const coverage = q.size ? present.length / q.size : 0;
        const retrievedCoverage = top.map((t) => {
          const tw = docWords(t);
          return q.size ? [...q].filter((w) => tw.has(w)).length / q.size : 0;
        });
        rows.push({
          caseId: result.id,
          question: result.question,
          hit: top.includes(id),
          title: doc.title,
          chunks: doc.chunks.length,
          coverage,
          present,
          missing,
          bestRetrievedCoverage: Math.max(0, ...retrievedCoverage),
          retrievedTitles: top.slice(0, 3).map((t) => corpus.byId.get(t)?.title ?? t),
          tags: evalCase.tags ?? [],
        });
      }
    }

    const hits = rows.filter((r) => r.hit);
    const misses = rows.filter((r) => !r.hit);
    const below = (xs: Row[]) => xs.filter((r) => r.coverage < 0.5).length;
    const lines: string[] = [];
    lines.push(`# Retrieval misses by kind — k=${report.k}`, "");
    lines.push(`| | Count |`, `|---|---|`);
    lines.push(`| Labelled documents | ${rows.length} |`);
    lines.push(`| Hits | ${hits.length} |`);
    lines.push(`| Misses | ${misses.length} |`);
    lines.push(
      `| Misses on one-chunk documents | ${misses.filter((r) => r.chunks === 1).length} |`,
    );
    lines.push(
      `| Question-word coverage, hits (median) | ${median(hits.map((r) => r.coverage)).toFixed(2)} |`,
    );
    lines.push(
      `| Question-word coverage, misses (median) | ${median(misses.map((r) => r.coverage)).toFixed(2)} |`,
    );
    lines.push(`| Coverage below 0.5, hits | ${below(hits)} of ${hits.length} |`);
    lines.push(`| Coverage below 0.5, misses | ${below(misses)} of ${misses.length} |`);
    lines.push("");
    lines.push(
      "Read each miss below: a low coverage with the key noun missing is lexical; a high coverage that still lost is ranking.",
      "",
    );
    for (const r of [...misses].sort((a, b) => a.coverage - b.coverage)) {
      lines.push(
        `## ${r.caseId} — coverage ${r.coverage.toFixed(2)}, target chunks ${r.chunks}, best retrieved coverage ${r.bestRetrievedCoverage.toFixed(2)}${r.tags.length ? `, tags ${r.tags.join(", ")}` : ""}`,
      );
      lines.push(`- Question: ${r.question}`);
      lines.push(`- Target: ${r.title}`);
      lines.push(`- Present in target: ${r.present.join(", ") || "(none)"}`);
      lines.push(`- Missing from target: ${r.missing.join(", ") || "(none)"}`);
      lines.push(`- Top retrieved: ${r.retrievedTitles.join(" · ")}`);
      lines.push("");
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
