import { chunks, type Database, documents, sources } from "@deskbell/db";
import { eq, inArray } from "drizzle-orm";
import { normalizeDocUrl } from "./target/project";
import type { Dataset, EvalCase, EvalCaseResult, EvalReport } from "./types";

// Re-exported for the root script, which has no dependency on the db package
// of its own; it reaches the database through this module or not at all.
export { createDb } from "@deskbell/db";

/**
 * Label audit (spec: eval-label-audit). Turns a report plus the corpus it ran
 * against into evidence for relabelling: for every case that fell short of
 * full recall, which labelled pages were and were not retrieved, which
 * unlabelled pages the answer cited, and whether each of those pages actually
 * contains the case's marking criteria.
 *
 * Never imported by `index.ts` — it needs the database, and the fixture path
 * must keep opening none.
 */

export interface AuditDocument {
  id: string;
  url: string | null;
  title: string;
  /** Chunk text in position order; what the fact check searches. */
  chunks: string[];
}

export interface AuditCorpus {
  byId: Map<string, AuditDocument>;
  /** Normalised URL → document id, the same mapping the run used for labels. */
  idByUrl: Map<string, string>;
}

export interface FactCheck {
  fact: string;
  present: boolean;
}

export type AuditRole = "label" | "cited" | "retrieved";

export interface AuditRow {
  role: AuditRole;
  documentId: string;
  url: string | null;
  title: string;
  /** 1-based rank among retrieved documents, or null when not retrieved. */
  rank: number | null;
  labelled: boolean;
  cited: boolean;
  chunkCount: number;
  facts: FactCheck[];
  keyFactPresent: boolean | null;
}

export type AuditVerdict =
  | "label-candidate"
  | "partial-candidate"
  | "ungrounded-correct"
  | "retrieval-miss";

export interface AuditCase {
  id: string;
  kind: EvalCase["kind"];
  question: string;
  grade: EvalCaseResult["grade"];
  recallAtK: number;
  verdict: AuditVerdict;
  rows: AuditRow[];
}

/**
 * The same rule the deterministic judge applies to answers: case and
 * whitespace do not decide whether a criterion is present.
 */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function factsPresent(facts: string[], doc: AuditDocument): FactCheck[] {
  const haystack = normalizeText(doc.chunks.join("\n"));
  return facts.map((fact) => ({ fact, present: haystack.includes(normalizeText(fact)) }));
}

/** Labels of one case as document ids, resolved the way the run resolved them. */
export function labelIds(evalCase: EvalCase, corpus: AuditCorpus): string[] {
  const ids = new Set(evalCase.relevantDocumentIds ?? []);
  for (const url of evalCase.relevantUrls ?? []) {
    const id = corpus.idByUrl.get(normalizeDocUrl(url));
    if (id) ids.add(id);
  }
  return [...ids];
}

function auditCase(
  result: EvalCaseResult,
  evalCase: EvalCase,
  corpus: AuditCorpus,
): AuditCase | null {
  if (result.retrieval === null || result.retrieval.recallAtK >= 1) return null;

  const labelled = labelIds(evalCase, corpus);
  const retrieved = result.retrievedDocumentIds ?? [];
  const cited = result.citedDocumentIds;
  const facts = evalCase.expectedFacts ?? [];

  const ordered = [...labelled, ...cited, ...retrieved];
  const rows: AuditRow[] = [];
  for (const id of ordered) {
    if (rows.some((r) => r.documentId === id)) continue;
    const doc = corpus.byId.get(id) ?? { id, url: null, title: "(not in corpus)", chunks: [] };
    const checks = factsPresent(facts, doc);
    const rank = retrieved.indexOf(id);
    rows.push({
      role: labelled.includes(id) ? "label" : cited.includes(id) ? "cited" : "retrieved",
      documentId: id,
      url: doc.url,
      title: doc.title,
      rank: rank === -1 ? null : rank + 1,
      labelled: labelled.includes(id),
      cited: cited.includes(id),
      chunkCount: doc.chunks.length,
      facts: checks,
      keyFactPresent: evalCase.keyFact
        ? (checks.find((c) => c.fact === evalCase.keyFact)?.present ?? null)
        : null,
    });
  }

  // Mechanical, and only a prompt for a human: a candidate is a page the
  // answer cited that holds the criteria — someone still has to read it.
  const candidates = rows.filter((r) => r.role === "cited" && r.facts.length > 0);
  let verdict: AuditVerdict = "retrieval-miss";
  if (candidates.some((r) => r.facts.every((f) => f.present))) verdict = "label-candidate";
  else if (candidates.some((r) => r.keyFactPresent)) verdict = "partial-candidate";
  else if (result.grade === "A" || result.grade === "B") verdict = "ungrounded-correct";

  return {
    id: result.id,
    kind: result.kind,
    question: result.question,
    grade: result.grade,
    recallAtK: result.retrieval.recallAtK,
    verdict,
    rows,
  };
}

/** Every document id a report and its dataset refer to, for loading the corpus once. */
export function documentIdsInvolved(report: EvalReport, dataset: Dataset, corpus: AuditCorpus) {
  const ids = new Set<string>();
  for (const c of dataset.cases) for (const id of labelIds(c, corpus)) ids.add(id);
  for (const r of report.cases) {
    for (const id of r.citedDocumentIds) ids.add(id);
    for (const id of r.retrievedDocumentIds ?? []) ids.add(id);
  }
  return [...ids];
}

export function auditLabels(
  report: EvalReport,
  dataset: Dataset,
  corpus: AuditCorpus,
): AuditCase[] {
  const byId = new Map(dataset.cases.map((c) => [c.id, c]));
  const out: AuditCase[] = [];
  for (const result of report.cases) {
    const evalCase = byId.get(result.id);
    if (!evalCase) continue;
    const audited = auditCase(result, evalCase, corpus);
    if (audited) out.push(audited);
  }
  return out;
}

/**
 * Loads titles, URLs and chunk text for one project's corpus. All documents
 * are read (the URL map needs them); chunk text only for `documentIds`.
 */
export async function loadAuditCorpus(
  db: Database,
  projectId: string,
  documentIds: (idByUrl: Map<string, string>) => string[],
): Promise<AuditCorpus> {
  const docs = await db
    .select({ id: documents.id, url: documents.url, title: documents.title })
    .from(documents)
    .innerJoin(sources, eq(sources.id, documents.sourceId))
    .where(eq(sources.projectId, projectId));

  const idByUrl = new Map<string, string>();
  const byId = new Map<string, AuditDocument>();
  for (const d of docs) {
    if (d.url) idByUrl.set(normalizeDocUrl(d.url), d.id);
    byId.set(d.id, { id: d.id, url: d.url, title: d.title, chunks: [] });
  }

  const wanted = documentIds(idByUrl).filter((id) => byId.has(id));
  if (wanted.length > 0) {
    const rows = await db
      .select({ documentId: chunks.documentId, position: chunks.position, content: chunks.content })
      .from(chunks)
      .where(inArray(chunks.documentId, wanted))
      .orderBy(chunks.documentId, chunks.position);
    for (const row of rows) byId.get(row.documentId)?.chunks.push(row.content);
  }

  return { byId, idByUrl };
}

function cell(s: string | null): string {
  return (s ?? "—").replace(/\|/g, "\\|");
}

export function renderLabelAudit(cases: AuditCase[], k: number): string {
  const counts = new Map<AuditVerdict, number>();
  for (const c of cases) counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1);

  const lines: string[] = [];
  lines.push("# Label audit");
  lines.push("");
  lines.push(`${cases.length} cases below full recall@${k}.`);
  lines.push("");
  lines.push("| verdict | cases |");
  lines.push("|---|---|");
  for (const v of [
    "label-candidate",
    "partial-candidate",
    "ungrounded-correct",
    "retrieval-miss",
  ] as const) {
    lines.push(`| ${v} | ${counts.get(v) ?? 0} |`);
  }
  lines.push("");
  lines.push(
    "A candidate is a page the answer cited that contains the case's criteria as text. " +
      "Read the page before adding it as a label — a substring is evidence, not a verdict.",
  );

  for (const c of cases) {
    lines.push("");
    lines.push(
      `## ${c.id} — ${c.grade ?? "ungraded"} · recall ${c.recallAtK.toFixed(2)} · ${c.verdict}`,
    );
    lines.push("");
    lines.push(`> ${c.question}`);
    lines.push("");
    lines.push("| role | rank | title | url | chunks | facts | missing |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of c.rows) {
      const present = r.facts.filter((f) => f.present).length;
      const missing = r.facts.filter((f) => !f.present).map((f) => f.fact);
      lines.push(
        `| ${r.role} | ${r.rank ?? "—"} | ${cell(r.title)} | ${cell(r.url)} | ${r.chunkCount} | ` +
          `${present}/${r.facts.length} | ${cell(missing.join("; ") || null)} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
