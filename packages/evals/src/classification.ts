import { INTENTS, type Intent, SIGNALS, type Signal } from "@deskbell/shared";

/**
 * Scoring for the question classifier (spec: intent-and-signals): how far
 * the model's intents and signals agree with a labelled set. Pure, so the
 * script that runs the model and this file that scores it can be tested
 * apart. Two kinds of number, never blended: intent is one label per
 * question, so it is agreement and a confusion table; signals are a set per
 * question, so each is precision and recall on its own — a false "wants a
 * human" and a missed "pushback" are different mistakes with different costs.
 */

export interface LabelledCase {
  id: string;
  question: string;
  previous?: string;
  intent: Intent;
  signals: Signal[];
}

export interface Prediction {
  id: string;
  intent: Intent;
  signals: Signal[];
}

export interface SignalScore {
  signal: Signal;
  /** Of the questions the model gave the signal, how many the labels agree with. Null when it never did. */
  precision: number | null;
  /** Of the questions the labels give the signal, how many the model found. Null when the set has none. */
  recall: number | null;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface ClassificationReport {
  cases: number;
  /** Questions whose predicted intent is the labelled one, over all questions. */
  intentAgreement: number | null;
  /** Agreement per labelled intent, for the intents the set contains. */
  intentRecall: Partial<Record<Intent, { agreed: number; total: number }>>;
  /** confusion[labelled][predicted] = count. */
  confusion: Partial<Record<Intent, Partial<Record<Intent, number>>>>;
  signals: SignalScore[];
  /** The ids each mismatch belongs to, so a failed gate can be read case by case. */
  intentMisses: Array<{ id: string; labelled: Intent; predicted: Intent }>;
  signalMisses: Array<{ id: string; labelled: Signal[]; predicted: Signal[] }>;
}

/** The gate the prompt has to clear before the labels reach a dashboard. */
export const CLASSIFICATION_GATE = {
  intentAgreement: 0.8,
  wantsHumanPrecision: 0.9,
  pushbackRecall: 0.7,
} as const;

export function scoreClassification(
  cases: readonly LabelledCase[],
  predictions: readonly Prediction[],
): ClassificationReport {
  const predicted = new Map(predictions.map((p) => [p.id, p]));
  const confusion: ClassificationReport["confusion"] = {};
  const intentRecall: ClassificationReport["intentRecall"] = {};
  const intentMisses: ClassificationReport["intentMisses"] = [];
  const signalMisses: ClassificationReport["signalMisses"] = [];
  const counts = new Map(
    SIGNALS.map((s) => [s, { truePositives: 0, falsePositives: 0, falseNegatives: 0 }]),
  );
  let agreed = 0;
  let scored = 0;
  for (const c of cases) {
    const p = predicted.get(c.id);
    if (!p) continue;
    scored += 1;
    const row = confusion[c.intent] ?? {};
    confusion[c.intent] = row;
    row[p.intent] = (row[p.intent] ?? 0) + 1;
    const r = intentRecall[c.intent] ?? { agreed: 0, total: 0 };
    intentRecall[c.intent] = r;
    r.total += 1;
    if (p.intent === c.intent) {
      agreed += 1;
      r.agreed += 1;
    } else {
      intentMisses.push({ id: c.id, labelled: c.intent, predicted: p.intent });
    }
    const want = new Set(c.signals);
    const got = new Set(p.signals);
    if (SIGNALS.some((s) => want.has(s) !== got.has(s)))
      signalMisses.push({
        id: c.id,
        labelled: SIGNALS.filter((s) => want.has(s)),
        predicted: SIGNALS.filter((s) => got.has(s)),
      });
    for (const s of SIGNALS) {
      const n = counts.get(s);
      if (!n) continue;
      if (want.has(s) && got.has(s)) n.truePositives += 1;
      else if (got.has(s)) n.falsePositives += 1;
      else if (want.has(s)) n.falseNegatives += 1;
    }
  }
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    cases: scored,
    intentAgreement: ratio(agreed, scored),
    intentRecall,
    confusion,
    signals: SIGNALS.map((signal) => {
      const n = counts.get(signal) ?? { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
      return {
        signal,
        precision: ratio(n.truePositives, n.truePositives + n.falsePositives),
        recall: ratio(n.truePositives, n.truePositives + n.falseNegatives),
        ...n,
      };
    }),
    intentMisses,
    signalMisses,
  };
}

/** What the gate says about a report: every threshold that is not met, in words. */
export function classificationGateFailures(report: ClassificationReport): string[] {
  const failures: string[] = [];
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
  if (
    report.intentAgreement !== null &&
    report.intentAgreement < CLASSIFICATION_GATE.intentAgreement
  )
    failures.push(
      `intent agreement ${pct(report.intentAgreement)} is under ${pct(CLASSIFICATION_GATE.intentAgreement)}`,
    );
  const wants = report.signals.find((s) => s.signal === "wants_human");
  if (
    wants?.precision !== null &&
    wants?.precision !== undefined &&
    wants.precision < CLASSIFICATION_GATE.wantsHumanPrecision
  )
    failures.push(
      `wants_human precision ${pct(wants.precision)} is under ${pct(CLASSIFICATION_GATE.wantsHumanPrecision)}`,
    );
  const push = report.signals.find((s) => s.signal === "pushback");
  if (
    push?.recall !== null &&
    push?.recall !== undefined &&
    push.recall < CLASSIFICATION_GATE.pushbackRecall
  )
    failures.push(
      `pushback recall ${pct(push.recall)} is under ${pct(CLASSIFICATION_GATE.pushbackRecall)}`,
    );
  return failures;
}

/**
 * One JSONL line per case: `{ "id"?, "question", "previous"?, "intent", "signals"? }`.
 * A line without an id is numbered by position. A bad line names its number.
 */
export function parseLabelledSet(text: string): LabelledCase[] {
  const cases: LabelledCase[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line || line.startsWith("#")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1}: not JSON`);
    }
    if (!raw || typeof raw !== "object") throw new Error(`line ${i + 1}: not an object`);
    const o = raw as Record<string, unknown>;
    if (typeof o.question !== "string" || !o.question.trim())
      throw new Error(`line ${i + 1}: "question" is required`);
    if (!(INTENTS as readonly string[]).includes(String(o.intent)))
      throw new Error(`line ${i + 1}: "intent" must be one of ${INTENTS.join(", ")}`);
    const signals = o.signals === undefined ? [] : o.signals;
    if (
      !Array.isArray(signals) ||
      !signals.every((s) => (SIGNALS as readonly string[]).includes(String(s)))
    )
      throw new Error(`line ${i + 1}: "signals" must list only ${SIGNALS.join(", ")}`);
    cases.push({
      id: typeof o.id === "string" && o.id ? o.id : `line-${i + 1}`,
      question: o.question,
      previous: typeof o.previous === "string" && o.previous.trim() ? o.previous : undefined,
      intent: o.intent as Intent,
      signals: signals as Signal[],
    });
  }
  return cases;
}

/** The report as Markdown: the gate first, then the tables, then the misses. */
export function renderClassificationMarkdown(
  report: ClassificationReport,
  meta: { model: string; dataset: string },
): string {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
  const failures = classificationGateFailures(report);
  const lines = [
    "# Question classifier",
    "",
    `Model: ${meta.model} · Set: ${meta.dataset} · Cases: ${report.cases}`,
    "",
    failures.length === 0 ? "**Gate: passed.**" : `**Gate: failed** — ${failures.join("; ")}.`,
    "",
    `## Intent — agreement ${pct(report.intentAgreement)} (gate ${pct(CLASSIFICATION_GATE.intentAgreement)})`,
    "",
    `| Labelled | Cases | Agreed | ${INTENTS.join(" | ")} |`,
    `|---|---|---|${INTENTS.map(() => "---").join("|")}|`,
    ...INTENTS.filter((i) => report.intentRecall[i]).map((labelled) => {
      const r = report.intentRecall[labelled] ?? { agreed: 0, total: 0 };
      const row = report.confusion[labelled] ?? {};
      return `| ${labelled} | ${r.total} | ${pct(r.total ? r.agreed / r.total : null)} | ${INTENTS.map((p) => row[p] ?? 0).join(" | ")} |`;
    }),
    "",
    "## Signals",
    "",
    "| Signal | Precision | Recall | TP | FP | FN |",
    "|---|---|---|---|---|---|",
    ...report.signals.map(
      (s) =>
        `| ${s.signal} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.truePositives} | ${s.falsePositives} | ${s.falseNegatives} |`,
    ),
    "",
    `Gate: wants_human precision ≥ ${pct(CLASSIFICATION_GATE.wantsHumanPrecision)}, pushback recall ≥ ${pct(CLASSIFICATION_GATE.pushbackRecall)}.`,
  ];
  if (report.intentMisses.length > 0) {
    lines.push("", "## Intent misses", "", "| Case | Labelled | Predicted |", "|---|---|---|");
    for (const m of report.intentMisses) lines.push(`| ${m.id} | ${m.labelled} | ${m.predicted} |`);
  }
  if (report.signalMisses.length > 0) {
    lines.push("", "## Signal misses", "", "| Case | Labelled | Predicted |", "|---|---|---|");
    for (const m of report.signalMisses)
      lines.push(
        `| ${m.id} | ${m.labelled.join(", ") || "—"} | ${m.predicted.join(", ") || "—"} |`,
      );
  }
  return `${lines.join("\n")}\n`;
}
