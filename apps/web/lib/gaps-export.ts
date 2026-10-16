import { normalizeQuestion } from "@deskbell/db";

import { evidenceLabel } from "./citation-label";
import { csvCell } from "./csv";
import {
  DEFAULT_STATUS,
  type GapEvidence,
  type GapGroup,
  type GapGroupWithTrend,
  type Period,
  type StatusKey,
} from "./gaps";

/** The marker an operator must replace before the case can grade anything. */
export const FACT_PLACEHOLDER = "TODO: a fact a correct answer must contain";

/**
 * Exports of the gaps view (spec: gaps-export): a dataset the eval harness
 * loads unchanged, and a CSV for the people who fix documentation. Pure
 * functions over the groups the page already built, so a download is what
 * was on screen.
 */

/** The shape the harness's dataset parser accepts; kept structural so this file owns no evals import. */
export interface ExportedCase {
  id: string;
  question: string;
  kind: "answerable";
  expectedFacts: string[];
  relevantUrls: string[];
  tags: string[];
  notes: string;
  source: { kind: "real"; messageId: string; capturedAt: string };
}

export interface ExportedDataset {
  name: string;
  description: string;
  cases: ExportedCase[];
}

function slugOf(text: string): string {
  return (
    normalizeQuestion(text)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "question"
  );
}

/** Short, stable, printable: the last six characters of a cluster id, or a hash of the key. */
function idTail(group: GapGroup): string {
  if (group.clusterId) return group.clusterId.slice(-6);
  let hash = 0;
  for (const ch of group.key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 6);
}

export function tagsFor(group: GapGroup): string[] {
  const tags = ["real-traffic"];
  if (group.refusals > 0) tags.push("refused");
  if (group.downvotes > 0) tags.push("downvoted");
  if (group.weak > 0) tags.push("weak-answer");
  if (group.unsupported > 0) tags.push("unsupported-terms");
  if (group.status === "resolved") tags.push("resolved");
  return tags;
}

/**
 * The eval case for a group, ready to paste or to ship in a dataset.
 *
 * Valid as written — it loads — and useless until someone replaces the
 * placeholder with real marking criteria and labels the page that answers
 * it. That is the point: a person decides what correct means; this only
 * saves them retyping the question and the provenance.
 */
export function evalCaseFor(
  group: GapGroup,
  options: { suggestedFacts?: string[] } = {},
): ExportedCase {
  const facts = (options.suggestedFacts ?? group.analysis?.suggestedFacts ?? [])
    .map((f) => f.trim())
    .filter(Boolean);
  const evidence = [...group.found, ...group.cited]
    .map((e) => e.url)
    .filter((u): u is string => typeof u === "string");
  const notes = [
    `Asked ${group.count} ${group.count === 1 ? "time" : "times"}; refused ${group.refusals}, downvoted ${group.downvotes}, weakly evidenced ${group.weak}.`,
    group.variants.length > 1
      ? `Other phrasings: ${group.variants
          .filter((v) => v !== group.question)
          .slice(0, 5)
          .map((v) => JSON.stringify(v))
          .join(", ")}.`
      : null,
    evidence.length > 0
      ? `The engine found or cited: ${[...new Set(evidence)].slice(0, 5).join(", ")} — evidence, not labels.`
      : null,
    facts.length > 0
      ? "Marking criteria were suggested by analysis; check them before trusting a grade."
      : "Replace the placeholder fact and add the page that answers it.",
  ]
    .filter((s): s is string => s !== null)
    .join(" ");
  return {
    id: `real-${slugOf(group.question)}-${idTail(group)}`,
    question: group.question,
    kind: "answerable",
    expectedFacts: facts.length > 0 ? facts : [FACT_PLACEHOLDER],
    relevantUrls: [],
    tags: tagsFor(group),
    notes,
    source: {
      kind: "real",
      messageId: group.latestMessageId,
      capturedAt: group.lastSeen.toISOString(),
    },
  };
}

/** The copy-button text: the exported case, pretty-printed, ready to paste into a dataset file. */
export function evalCaseSkeleton(group: GapGroup): string {
  return `${JSON.stringify(evalCaseFor(group), null, 2)}\n`;
}

/** `-resolved` or `-all` on a name when the view is not the default open one. */
function statusSuffix(status: StatusKey | undefined): string {
  return status && status !== DEFAULT_STATUS ? `-${status}` : "";
}

export function toDataset(
  groups: GapGroup[],
  context: { projectName: string; period: Period; exportedAt: Date; status?: StatusKey },
): ExportedDataset {
  const cases = groups.map((g) => evalCaseFor(g));
  // Ids are unique by construction (slug + cluster tail); a collision would
  // mean two clusters share a tail, which is a bug worth surfacing, not
  // papering over with a counter.
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate export id ${c.id}`);
    seen.add(c.id);
  }
  return {
    name: `real-traffic-${slugOf(context.projectName)}-${context.period.key}${statusSuffix(context.status)}`,
    description:
      `Questions ${context.projectName} could not answer (${periodLabel(context.period)}), ` +
      `exported ${context.exportedAt.toISOString().slice(0, 10)}. Every case carries a placeholder ` +
      "marking criterion until a person writes the real one.",
    cases,
  };
}

function periodLabel(period: Period): string {
  return period.key === "all" ? "all time" : `last ${period.key.replace("d", " days")}`;
}

export const CSV_COLUMNS = [
  "cluster_id",
  "question",
  "status",
  "times",
  "refused",
  "marked_down",
  "weak",
  "unsupported",
  "unsupported_terms",
  "previous_period_times",
  "trend",
  "first_seen",
  "last_seen",
  "downvote_reasons",
  "sample_phrasings",
  "found_documents",
  "cited_documents",
  "latest_conversation_path",
  "analysis_title",
  "finding",
  "recommendation",
] as const;

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection:
 * questions are visitor-typed text, and a cell starting with `=`, `+`, `-`,
 * `@`, tab or carriage return would otherwise be evaluated on open.
 */
export { csvCell };

export function toCsv(groups: GapGroupWithTrend[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const g of groups) {
    const reasons = Object.entries(g.reasons)
      .map(([r, n]) => (n > 1 ? `${r} ×${n}` : r))
      .join("; ");
    const docs = (items: GapEvidence[]) => items.map(evidenceLabel).join("; ");
    const row: Record<(typeof CSV_COLUMNS)[number], string | number | null> = {
      cluster_id: g.clusterId,
      question: g.question,
      status: g.status,
      times: g.count,
      refused: g.refusals,
      marked_down: g.downvotes,
      weak: g.weak,
      unsupported: g.unsupported,
      unsupported_terms: g.unsupportedTerms
        .map((t) => (t.count > 1 ? `${t.term} ×${t.count}` : t.term))
        .join("; "),
      previous_period_times: g.trend === null ? null : g.previousCount,
      trend: g.trend,
      first_seen: g.firstSeen.toISOString(),
      last_seen: g.lastSeen.toISOString(),
      downvote_reasons: reasons,
      sample_phrasings: g.variants
        .filter((v) => v !== g.question)
        .slice(0, 5)
        .join("; "),
      found_documents: docs(g.found),
      cited_documents: docs(g.cited),
      latest_conversation_path: `/conversations/${g.latestConversationId}`,
      analysis_title: g.analysis?.title ?? null,
      finding: g.analysis?.finding ?? null,
      recommendation: g.analysis?.recommendation ?? null,
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export type ExportFormat = "csv" | "dataset" | "prompts";

const EXTENSION: Record<ExportFormat, string> = { csv: "csv", dataset: "json", prompts: "md" };

export function exportFilename(
  format: ExportFormat,
  projectName: string,
  period: Period,
  at: Date,
  status?: StatusKey,
): string {
  const ext = EXTENSION[format];
  const view = `${period.key}${statusSuffix(status)}`;
  return `deskbell-gaps-${slugOf(projectName)}-${view}-${at.toISOString().slice(0, 10)}.${ext}`;
}
