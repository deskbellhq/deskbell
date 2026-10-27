/**
 * Measures the question classifier (spec: intent-and-signals) against a
 * labelled set: one JSONL line per question with the intent and signals two
 * people agreed on. Runs the real chat model — there is no stub for a
 * labelling task — so it needs the provider key the server uses, and it
 * never gates CI. Reports intent agreement with its confusion table and
 * each signal's precision and recall, and says whether the gate is met.
 *
 * A set built from a deployment's own traffic belongs in
 * `packages/evals/datasets/private/`, untracked like every other set that
 * cannot be republished. The committed `datasets/intents.jsonl` is authored
 * and small: it exercises the script, it is not a quality claim.
 *
 * Usage:
 *   pnpm evals:classify --product "Acme Feeds"
 *   pnpm evals:classify --dataset packages/evals/datasets/private/intents.jsonl \
 *     --markdown packages/evals/reports/intents.md
 *   pnpm evals:classify --check      # exit 1 when the gate is not met
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { OTHER_TOPIC } from "@deskbell/shared";
import { createQuestionClassifierDeps } from "../packages/core/src/models/index";
import {
  CLASSIFICATION_GATE,
  classificationGateFailures,
  type Prediction,
  parseLabelledSet,
  renderClassificationMarkdown,
  scoreClassification,
} from "../packages/evals/src/classification";

const { values } = parseArgs({
  options: {
    dataset: { type: "string", default: "packages/evals/datasets/intents.jsonl" },
    concurrency: { type: "string", default: "4" },
    // What the questions are about, as the worker tells the model the project's name.
    product: { type: "string" },
    markdown: { type: "string" },
    check: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const datasetPath = resolve(values.dataset);
  const cases = parseLabelledSet(readFileSync(datasetPath, "utf8"));
  if (cases.length === 0) {
    console.error(`error: ${values.dataset} has no cases`);
    process.exit(2);
  }
  const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 1);
  const classifier = createQuestionClassifierDeps();

  console.log(`classifying ${cases.length} questions with ${classifier.modelId}…`);
  const predictions: Prediction[] = [];
  let usage = { input: 0, output: 0 };
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const c = cases[next++];
      if (!c) return;
      try {
        const labels = await classifier.classify(
          {
            question: c.question,
            previous: c.previous,
            product: values.product,
            topics: [],
            other: OTHER_TOPIC,
          },
          {
            onUsage: (u) => {
              usage = { input: usage.input + u.input, output: usage.output + u.output };
            },
          },
        );
        predictions.push({ id: c.id, intent: labels.intent, signals: labels.signals });
      } catch (error) {
        console.error(`  ${c.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const report = scoreClassification(cases, predictions);
  const markdown = renderClassificationMarkdown(report, {
    model: classifier.modelId,
    dataset: values.dataset,
  });
  console.log(`\n${markdown}`);
  console.log(`tokens: ${usage.input} in, ${usage.output} out`);
  if (values.markdown) {
    const out = resolve(values.markdown);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown);
    console.log(`wrote ${values.markdown}`);
  }
  if (predictions.length < cases.length) {
    console.error(
      `${cases.length - predictions.length} of ${cases.length} questions failed to classify`,
    );
    if (values.check) process.exit(1);
  }
  const failures = classificationGateFailures(report);
  if (values.check && failures.length > 0) {
    console.error(
      `gate not met (intent ≥ ${CLASSIFICATION_GATE.intentAgreement}, wants_human precision ≥ ${CLASSIFICATION_GATE.wantsHumanPrecision}, pushback recall ≥ ${CLASSIFICATION_GATE.pushbackRecall}): ${failures.join("; ")}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
