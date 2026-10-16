import type { EvalReport } from "./types";

const DASH = "—";

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return DASH;
  return value.toFixed(digits);
}

/**
 * The markdown a human reads — in a terminal, or in a CI job summary. The two
 * headline numbers lead and are never averaged together: a system can buy
 * either at the other's expense.
 */
export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [];

  lines.push(`### Eval report — ${report.dataset}`);
  lines.push("");
  lines.push(
    `Target \`${report.target}\` · judge \`${report.judge}\` · k=${report.k} · ${report.total} cases${
      report.promptHash ? ` · prompt \`${report.promptHash}\`` : ""
    }`,
  );
  lines.push("");
  if (report.retrievalOnly) {
    lines.push(
      "> Retrieval only: no answer was generated and nothing was graded. Every quality metric below reads as unassessed rather than as zero.",
    );
    lines.push("");
  }
  lines.push("| Metric | Value | Over |");
  lines.push("|---|---:|---|");

  const answerable = report.cases.filter((c) => c.kind === "answerable").length;
  const injection = report.cases.filter((c) => c.kind === "injection").length;
  const ambiguous = report.cases.filter((c) => c.kind === "ambiguous").length;
  const unanswerable = report.total - answerable - injection - ambiguous;

  lines.push(`| **Factuality** | ${pct(report.factuality)} | ${answerable} answerable |`);
  lines.push(`| **Uncertainty** | ${pct(report.uncertainty)} | ${unanswerable} unanswerable |`);
  lines.push(`| False-refusal rate | ${pct(report.falseRefusalRate)} | ${answerable} answerable |`);
  // Only when the run has something to say: a set with no ambiguous cases on
  // an engine that never asked would otherwise carry two rows of zeros.
  if (report.clarification !== null || report.clarified > 0) {
    if (report.clarification !== null) {
      lines.push(`| **Clarification** | ${pct(report.clarification)} | ${ambiguous} ambiguous |`);
    }
    lines.push(`| Clarify rate | ${pct(report.clarifyRate)} | ${answerable} answerable |`);
  }
  lines.push(
    `| Groundedness | ${pct(report.groundedness)} | ${report.groundedness === null ? "not assessed" : "answered"} |`,
  );
  // Only when something was checked: with verification off the row would
  // read as a perfect score for a check that never ran.
  if (report.unsupportedTermRate !== null) {
    const checked = report.cases.filter((c) => c.unsupportedTermCount !== null).length;
    lines.push(
      `| Unsupported-name rate | ${pct(report.unsupportedTermRate)} | ${checked} checked |`,
    );
  }

  if (report.injectionResistance !== null) {
    lines.push(
      `| **Injection resistance** | ${pct(report.injectionResistance)} | ${injection} injection |`,
    );
  }

  if (report.retrieval) {
    lines.push(
      `| recall@${report.k} | ${num(report.retrieval.recallAtK)} | ${report.retrieval.cases} labelled |`,
    );
    lines.push(
      `| precision@${report.k} | ${num(report.retrieval.precisionAtK)} | ${report.retrieval.cases} labelled |`,
    );
    lines.push(`| MRR | ${num(report.retrieval.mrr)} | ${report.retrieval.cases} labelled |`);
    lines.push(
      `| nDCG@${report.k} | ${num(report.retrieval.ndcgAtK)} | ${report.retrieval.cases} labelled |`,
    );
  } else {
    lines.push(`| retrieval | ${DASH} | not observable through this target |`);
  }

  if (report.citations) {
    lines.push(
      `| Citation precision | ${num(report.citations.precision)} | ${report.citations.cases} labelled |`,
    );
    lines.push(
      `| Citation recall | ${num(report.citations.recall)} | ${report.citations.cases} labelled |`,
    );
  }

  if (report.alignment) {
    const a = report.alignment;
    lines.push("");
    lines.push(
      `Judge vs human on ${a.labelled} labelled case${a.labelled === 1 ? "" : "s"}: ${pct(a.exactAgreement)} exact · ${pct(a.binaryAgreement)} on acceptable-or-not`,
    );
    const rows = Object.entries(a.disagreements);
    if (rows.length > 0) {
      lines.push("");
      lines.push("| Case | Human → judge |");
      lines.push("|---|---|");
      for (const [id, move] of rows) lines.push(`| \`${id}\` | ${move} |`);
    }
  }

  if (report.judgeAnomalies > 0) {
    lines.push("");
    lines.push(
      `> The judge returned a fact outside the marking criteria on ${report.judgeAnomalies} case${report.judgeAnomalies === 1 ? "" : "s"} — it paraphrased the criteria instead of applying them. Those strings were dropped rather than scored.`,
    );
  }

  lines.push("");
  lines.push(
    `Cost: ${report.cost.inputTokens} in · ${report.cost.outputTokens} out · ${report.cost.embeddingTokens} embedding · median ${report.cost.medianLatencyMs.toFixed(0)}ms · p95 ${report.cost.p95LatencyMs.toFixed(0)}ms`,
  );

  // Nothing was graded in a retrieval-only run, so every case would list here
  // with an em dash — a page of rows that say only "not measured".
  const problems = report.retrievalOnly
    ? []
    : report.cases.filter(
        (c) =>
          (c.kind === "answerable" && c.grade !== "A") ||
          (c.kind === "unanswerable" && !c.correctRefusal) ||
          (c.kind === "ambiguous" && !c.correctClarification),
      );

  if (problems.length > 0) {
    lines.push("");
    lines.push(`#### ${problems.length} case${problems.length === 1 ? "" : "s"} below full marks`);
    lines.push("");
    lines.push("| Case | Kind | Grade | Why |");
    lines.push("|---|---|---|---|");
    for (const c of problems) {
      const grade =
        c.grade ??
        (c.correctRefusal === false ? "answered" : c.kind === "ambiguous" ? "not asked" : DASH);
      lines.push(`| \`${c.id}\` | ${c.kind} | ${grade} | ${c.reason.replaceAll("|", "\\|")} |`);
    }
  }

  const tags = Object.entries(report.tagFrequency).sort((a, b) => b[1] - a[1]);
  if (tags.length > 0) {
    lines.push("");
    lines.push("#### Failure modes among those cases");
    lines.push("");
    lines.push("| Mode | Cases |");
    lines.push("|---|---:|");
    for (const [tag, count] of tags) lines.push(`| ${tag} | ${count} |`);
  }

  if (report.injectionResistance !== null && report.injectionResistance < 1) {
    lines.push("");
    lines.push(
      "> An injection case was obeyed. This is a security finding, not a quality one — read it before anything else in this table.",
    );
  }

  if (report.citations && report.citations.precision < 1) {
    lines.push("");
    // Which caveat applies depends on the target, and the wrong one is worse
    // than none: it tells the reader the number means something it does not.
    lines.push(
      report.target.startsWith("fixture")
        ? "> Read citation precision against the target. The model is asked to name the blocks it used and the engine cites only those, so this measures citing behaviour — but against the fixture's extractive generator, which knows exactly what it quoted, it measures the plumbing instead. A model's willingness to cite honestly needs a real target."
        : "> Citation precision is bounded by how completely these cases are labelled. A cited document counts as wrong unless it appears in `relevantDocumentIds`, so a case labelled with one document whose answer legitimately draws on three cannot score above 0.33 however well the engine behaved. Read a low value as a question about the labels before the engine — citation recall is the half that does not depend on labelling completeness.",
    );
  }

  return lines.join("\n");
}

/** The full record, per-case rows included, so two runs can be diffed. */
export function renderJson(report: EvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
