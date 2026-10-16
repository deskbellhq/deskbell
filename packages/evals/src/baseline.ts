import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalReport, Grade, RetrievalProvenance } from "./types";

const DATASETS_DIR = fileURLToPath(new URL("../datasets", import.meta.url));
const BASELINES_DIR = fileURLToPath(new URL("../baselines", import.meta.url));

/**
 * Where a dataset's baseline belongs: the dataset's own position under
 * `datasets/`, mirrored into `baselines/`.
 *
 * The pairing follows the dataset's *location* and not only its name, because
 * a baseline is not a summary — it lists every case id alongside the set's
 * numbers. Question sets built against a corpus that is not ours to republish
 * live under `datasets/private/`, which is untracked; if their baselines still
 * landed in the tracked `baselines/` root, that directory would be holding
 * back the questions while committing the answer key. Mirroring the subpath
 * makes the matching placement automatic instead of a flag someone has to
 * remember on every run.
 *
 * A dataset outside this package's `datasets/` tree gets its baseline written
 * beside itself: a path we do not control is not one to derive a repository
 * write from.
 */
export function defaultBaselinePath(datasetPath: string, name: string): string {
  const dir = dirname(resolve(datasetPath));
  const within = relative(DATASETS_DIR, dir);
  if (within.startsWith("..") || isAbsolute(within)) return join(dir, `${name}.baseline.json`);
  return join(BASELINES_DIR, within, `${name}.json`);
}

/**
 * The stable half of a report: the numbers, and each case's outcome. Timing
 * and token counts are deliberately excluded — they vary run to run for
 * reasons that have nothing to do with answer quality, and a gate that trips
 * on a slow CI runner is a gate people learn to ignore.
 */
export interface Baseline {
  dataset: string;
  target: string;
  judge: string;
  /** Fingerprint of the system prompt; absent when the target cannot know it. */
  promptHash?: string;
  k: number;
  /**
   * The retrieval configuration the run measured; absent = shipped defaults.
   * A baseline that cannot say what it measured cannot be compared honestly —
   * a config difference reports as a CHANGE, never as a regression.
   */
  retrievalConfig?: RetrievalProvenance;
  metrics: {
    total: number;
    answered: number;
    refused: number;
    correctRefusals: number;
    factuality: number | null;
    uncertainty: number | null;
    falseRefusalRate: number | null;
    /**
     * Present only when the run had ambiguous cases or something asked (spec:
     * clarifying-questions), so baselines written before either existed, and
     * runs where neither applies, keep their shape.
     */
    clarification?: number | null;
    clarifyRate?: number | null;
    groundedness: number | null;
    /**
     * Present only when the run checked at least one answer (spec:
     * answer-verification), for the same reason as clarification: a baseline
     * written with verification off keeps its shape.
     */
    unsupportedTermRate?: number | null;
    injectionResistance: number | null;
    retrieval: {
      recallAtK: number;
      precisionAtK: number;
      mrr: number;
      ndcgAtK: number;
    } | null;
    citations: { precision: number; recall: number } | null;
  };
  /**
   * Per case: its grade, or how an unanswerable, injection or ambiguous case
   * behaved. An ambiguous case is "clarified" when it passed, "asked" when it
   * asked without every expected option, else "refused" or "answered".
   */
  outcomes: Record<string, Outcome>;
}

export type Outcome =
  | Grade
  | "refused"
  | "answered"
  | "resisted"
  | "obeyed"
  | "clarified"
  | "asked";

/** Four decimals: enough to see a real move, coarse enough to absorb float noise. */
function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function outcomeOf(c: EvalReport["cases"][number]): Outcome {
  if (c.kind === "unanswerable") return c.refused ? "refused" : "answered";
  if (c.kind === "ambiguous") {
    if (c.correctClarification) return "clarified";
    if (c.clarified) return "asked";
    return c.refused ? "refused" : "answered";
  }
  return c.grade as Grade;
}

export function toBaseline(report: EvalReport): Baseline {
  const outcomes: Record<string, Outcome> = {};
  for (const c of report.cases) outcomes[c.id] = outcomeOf(c);
  const clarifying = report.clarification !== null || report.clarified > 0;

  return {
    dataset: report.dataset,
    target: report.target,
    judge: report.judge,
    ...(report.promptHash === undefined ? {} : { promptHash: report.promptHash }),
    k: report.k,
    ...(report.retrievalConfig === undefined ? {} : { retrievalConfig: report.retrievalConfig }),
    metrics: {
      total: report.total,
      answered: report.answered,
      refused: report.refused,
      correctRefusals: report.correctRefusals,
      factuality: round(report.factuality),
      uncertainty: round(report.uncertainty),
      falseRefusalRate: round(report.falseRefusalRate),
      ...(clarifying
        ? {
            clarification: round(report.clarification),
            clarifyRate: round(report.clarifyRate),
          }
        : {}),
      groundedness: round(report.groundedness),
      ...(report.unsupportedTermRate === null
        ? {}
        : { unsupportedTermRate: round(report.unsupportedTermRate) }),
      injectionResistance: round(report.injectionResistance),
      retrieval: report.retrieval
        ? {
            recallAtK: round(report.retrieval.recallAtK) as number,
            precisionAtK: round(report.retrieval.precisionAtK) as number,
            mrr: round(report.retrieval.mrr) as number,
            ndcgAtK: round(report.retrieval.ndcgAtK) as number,
          }
        : null,
      citations: report.citations
        ? {
            precision: round(report.citations.precision) as number,
            recall: round(report.citations.recall) as number,
          }
        : null,
    },
    outcomes,
  };
}

export function serializeBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export interface BaselineDiff {
  ok: boolean;
  regressions: string[];
  improvements: string[];
  changes: string[];
}

/** Higher is better for every metric here except the two rates below. */
const HIGHER_IS_BETTER = [
  "factuality",
  "uncertainty",
  "clarification",
  "groundedness",
  "injectionResistance",
  "retrieval.recallAtK",
  "retrieval.precisionAtK",
  "retrieval.mrr",
  "retrieval.ndcgAtK",
  "citations.precision",
  "citations.recall",
] as const;

function pick(baseline: Baseline, path: string): number | null {
  const [head, tail] = path.split(".") as [keyof Baseline["metrics"], string | undefined];
  const value = baseline.metrics[head];
  if (value === null || value === undefined) return null;
  if (tail === undefined) return typeof value === "number" ? value : null;
  return (value as Record<string, number>)[tail] ?? null;
}

function fmt(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

export function compareToBaseline(
  current: Baseline,
  previous: Baseline,
  tolerance = 0.0001,
): BaselineDiff {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const changes: string[] = [];

  if (current.dataset !== previous.dataset) {
    changes.push(`dataset changed: ${previous.dataset} → ${current.dataset}`);
  }
  if (current.judge !== previous.judge) {
    changes.push(`judge changed: ${previous.judge} → ${current.judge}`);
  }
  if (current.k !== previous.k) {
    changes.push(`k changed: ${previous.k} → ${current.k}`);
  }
  // A prompt edit moves every quality number, and it is not a regression — it
  // is a different measurement. Reported so the diff cannot be read as one.
  if (current.promptHash !== previous.promptHash) {
    changes.push(
      `system prompt changed: ${previous.promptHash ?? "unrecorded"} → ${current.promptHash ?? "unrecorded"}`,
    );
  }
  // Key order is construction order on both sides (same code built both), so
  // stringify equality is exact here; a mismatch means the runs measured
  // different retrieval configurations and their numbers must not be diffed
  // as if only the code changed.
  if (JSON.stringify(current.retrievalConfig) !== JSON.stringify(previous.retrievalConfig)) {
    changes.push(
      `retrieval config changed: ${JSON.stringify(previous.retrievalConfig) ?? "defaults"} → ${
        JSON.stringify(current.retrievalConfig) ?? "defaults"
      }`,
    );
  }

  for (const path of HIGHER_IS_BETTER) {
    const now = pick(current, path);
    const before = pick(previous, path);
    if (now === null && before === null) continue;
    if (now === null || before === null) {
      changes.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
      continue;
    }
    if (now < before - tolerance) regressions.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
    else if (now > before + tolerance) improvements.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
  }

  // Lower is better for these: a refusal or a question back on an answerable
  // case is the cost side of uncertainty and clarification, and an answer
  // that names something the corpus lacks is the failure verification exists
  // to count.
  for (const path of ["falseRefusalRate", "clarifyRate", "unsupportedTermRate"] as const) {
    const now = pick(current, path);
    const before = pick(previous, path);
    if (now === null || before === null) {
      if (now !== before) changes.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
    } else if (now > before + tolerance) {
      regressions.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
    } else if (now < before - tolerance) {
      improvements.push(`${path}: ${fmt(before)} → ${fmt(now)}`);
    }
  }

  // Per-case movement matters even when the aggregate does not: one case going
  // A→C while another goes C→A leaves factuality untouched and is still two
  // things that changed.
  const ids = new Set([...Object.keys(current.outcomes), ...Object.keys(previous.outcomes)]);
  for (const id of [...ids].sort()) {
    const now = current.outcomes[id];
    const before = previous.outcomes[id];
    if (now === before) continue;
    if (before === undefined) changes.push(`case ${id}: new (${now})`);
    else if (now === undefined) changes.push(`case ${id}: removed (was ${before})`);
    else changes.push(`case ${id}: ${before} → ${now}`);
  }

  return {
    ok: regressions.length === 0 && changes.length === 0,
    regressions,
    improvements,
    changes,
  };
}

export function renderDiff(diff: BaselineDiff): string {
  const lines: string[] = [];
  if (diff.regressions.length > 0) {
    lines.push("Regressions:");
    for (const r of diff.regressions) lines.push(`  ↓ ${r}`);
  }
  if (diff.improvements.length > 0) {
    lines.push("Improvements:");
    for (const i of diff.improvements) lines.push(`  ↑ ${i}`);
  }
  if (diff.changes.length > 0) {
    lines.push("Changes:");
    for (const c of diff.changes) lines.push(`  · ${c}`);
  }
  if (lines.length === 0) lines.push("No change against the baseline.");
  return lines.join("\n");
}
