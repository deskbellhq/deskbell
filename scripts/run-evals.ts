/**
 * Runs the eval harness (D8) and reports.
 *
 * The default run is the committed fixture: a stub model, an in-memory vector
 * store, no database, no network, no API key — deterministic, so CI can gate on
 * it. `--project` swaps in a real project's corpus, and `--judge llm` swaps in a
 * real grader; those produce the absolute numbers the fixture deliberately does
 * not claim to.
 *
 * `pnpm evals:check` takes no `--dataset`: the gate is the fixture and only the
 * fixture, because it is the one set that runs identically on every machine.
 * A set built against a corpus we cannot republish belongs in
 * `packages/evals/datasets/private/` — untracked, and its baseline follows it
 * into `baselines/private/` on its own (see `defaultBaselinePath`).
 *
 * Usage:
 *   pnpm evals
 *   pnpm evals:check
 *   pnpm evals --project proj_dev --judge llm
 *   pnpm evals --target http --api-url http://localhost:3000 --project-key pk_dev_default
 *   pnpm evals --dataset packages/evals/datasets/private/acme.json --project proj_acme \
 *     --judge llm --markdown packages/evals/reports/acme.md
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { clarifyFromEnv } from "../packages/core/src/clarify-config";
import { ownDataFromEnv } from "../packages/core/src/own-data-config";
import { verifyFromEnv } from "../packages/core/src/verify-config";
import { buildFixture } from "../packages/evals/src/fixtures/index";
import {
  type Baseline,
  compareToBaseline,
  createDeterministicJudge,
  createEngineTarget,
  createHttpTarget,
  createLlmJudge,
  type Dataset,
  defaultBaselinePath,
  describeBalance,
  type Judge,
  loadDataset,
  parseHumanGrades,
  type RetrievalProvenance,
  renderDiff,
  renderJson,
  renderMarkdown,
  runEvals,
  serializeBaseline,
  type Target,
  toBaseline,
} from "../packages/evals/src/index";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    target: { type: "string", default: "engine" },
    project: { type: "string" },
    "api-url": { type: "string" },
    "project-key": { type: "string" },
    origin: { type: "string" },
    judge: { type: "string", default: "none" },
    "retrieval-only": { type: "boolean", default: false },
    labels: { type: "string" },
    k: { type: "string" },
    "min-score": { type: "string" },
    // The hybrid-retrieval sweep surface (spec: hybrid-retrieval). Project
    // target only — these configure the engine, and only the project target
    // builds one from flags.
    "retrieval-mode": { type: "string" },
    "multi-query": { type: "boolean", default: false },
    "leg-depth": { type: "string" },
    "ef-search": { type: "string" },
    pool: { type: "string" },
    "max-per-doc": { type: "string" },
    order: { type: "string" },
    rerank: { type: "string" },
    "rerank-model": { type: "string" },
    concurrency: { type: "string" },
    temperature: { type: "string" },
    "real-model": { type: "boolean", default: false },
    json: { type: "string" },
    markdown: { type: "string" },
    baseline: { type: "string" },
    check: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
}

/**
 * A mistyped flag stops the run rather than degrading to a default. The env
 * vars the server reads degrade on purpose — an instance must stay up — but a
 * sweep that quietly measured the default under the label you typed would
 * produce a number that is wrong in the one way nobody checks.
 */
function num(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`${flag} expects a number, got ${JSON.stringify(raw)}`);
  return value;
}

function int(flag: string, raw: string): number {
  const value = num(flag, raw);
  if (!Number.isInteger(value)) fail(`${flag} expects an integer, got ${JSON.stringify(raw)}`);
  return value;
}

function choice<T extends string>(flag: string, raw: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  fail(`${flag} expects one of ${allowed.join(" | ")}, got ${JSON.stringify(raw)}`);
}

/** The sweep flags only mean something where an engine is built from them. */
function assertNoSweepFlagsOutsideProject(context: string): void {
  const sweepFlags = [
    "retrieval-mode",
    "leg-depth",
    "ef-search",
    "pool",
    "max-per-doc",
    "order",
    "rerank",
    "rerank-model",
  ] as const;
  const passed = sweepFlags.filter((f) => values[f] !== undefined);
  if (values["multi-query"]) passed.push("multi-query" as (typeof sweepFlags)[number]);
  if (passed.length > 0) {
    fail(
      `--${passed[0]} configures the engine and needs --project; ${context}. ` +
        "Measuring under a label the target ignores would report a number nothing produced.",
    );
  }
}

type BuiltTarget = {
  target: Target;
  k: number;
  /** Absent where the target cannot know which prompt produced the answers. */
  promptHash?: string;
  /** Present only where an engine was built from flags (the project target). */
  retrievalConfig?: RetrievalProvenance;
  /** Only the project target can resolve URL labels — it is the one with a corpus. */
  resolveLabels?: (dataset: Dataset) => Promise<Dataset>;
};

/**
 * The names a checked answer could not support, as they are flagged (spec:
 * answer-verification). Reports keep only the count — answer text never lands
 * in one — so this is where a run's author reads what was flagged, and why a
 * rate moved.
 */
function printUnsupportedTerms(caseId: string, terms: string[]): void {
  console.error(`[verify] ${caseId}: ${terms.map((t) => JSON.stringify(t)).join(", ")}`);
}

async function buildTarget(): Promise<BuiltTarget> {
  if (values.target === "http") {
    assertNoSweepFlagsOutsideProject("the HTTP target measures a server's own env config");
    if (values["retrieval-only"]) {
      fail(
        "--retrieval-only needs an in-process target: over the wire there is no way to stop " +
          "a server after retrieval, and it reports no retrieved chunks to score.",
      );
    }
    const apiUrl = values["api-url"] ?? fail("--target http needs --api-url");
    const projectKey = values["project-key"] ?? fail("--target http needs --project-key");
    return {
      // The wire carries no retrieval detail, so k only labels the report.
      k: Number(values.k ?? 8),
      target: createHttpTarget({
        apiUrl,
        projectKey,
        // Defaults to the API's own origin, which the guard always allows.
        origin: values.origin ?? apiUrl,
      }),
    };
  }

  if (values.target !== "engine") fail(`unknown --target ${values.target}`);
  if (values.project) {
    // Imported lazily so a fixture run never opens a database connection or
    // loads a provider SDK.
    const { createProjectTarget } = await import("../packages/evals/src/target/project");
    // Retrieval settings must reach the engine, not just the report. Without
    // this a sweep silently measures the shipped defaults over and over and
    // reports them under whatever --k was typed.
    const retrieval = {
      ...(values.k === undefined ? {} : { limit: num("--k", values.k) }),
      ...(values["min-score"] === undefined
        ? {}
        : { minScore: num("--min-score", values["min-score"]) }),
      ...(values["retrieval-mode"] === undefined
        ? {}
        : {
            mode: choice("--retrieval-mode", values["retrieval-mode"], ["vector", "hybrid"]),
          }),
      ...(values["multi-query"] ? { multiQuery: true } : {}),
      ...(values["leg-depth"] === undefined
        ? {}
        : { legDepth: int("--leg-depth", values["leg-depth"]) }),
      ...(values["ef-search"] === undefined
        ? {}
        : { efSearch: int("--ef-search", values["ef-search"]) }),
      ...(values.pool === undefined ? {} : { pool: int("--pool", values.pool) }),
      ...(values["max-per-doc"] === undefined
        ? {}
        : { maxPerDocument: int("--max-per-doc", values["max-per-doc"]) }),
      ...(values.order === undefined
        ? {}
        : { order: choice("--order", values.order, ["fused", "cosine"]) }),
      ...(values.rerank === undefined
        ? {}
        : { rerank: choice("--rerank", values.rerank, ["off", "llm", "local"]) }),
      ...(values["rerank-model"] === undefined ? {} : { rerankModel: values["rerank-model"] }),
    };
    const built = await createProjectTarget({
      onUnsupportedTerms: printUnsupportedTerms,
      projectId: values.project,
      ...(Object.keys(retrieval).length === 0 ? {} : { retrieval }),
      ...(values.temperature === undefined ? {} : { temperature: Number(values.temperature) }),
      ...(values["retrieval-only"] ? { retrievalOnly: true } : {}),
    });
    return built;
  }
  assertNoSweepFlagsOutsideProject("the fixture measures drift, not retrieval configuration");

  // The controlled corpus driven by a real model: the only combination that can
  // test how a model behaves towards content we authored, which is what an
  // injection case needs.
  const generate = values["real-model"]
    ? (await import("../packages/core/src/models/index")).createEngineModelDeps(
        process.env,
        values.temperature === undefined ? {} : { temperature: Number(values.temperature) },
      ).generate
    : undefined;

  // Clarification only with a real model: the stub never asks, and the
  // fixture's prompt fingerprint must not move when nothing can change.
  const fixture = await buildFixture(
    generate
      ? { generate, clarify: clarifyFromEnv(), verify: verifyFromEnv(), ownData: ownDataFromEnv() }
      : {},
  );
  return {
    k: fixture.k,
    promptHash: fixture.promptHash,
    target: createEngineTarget({
      engine: fixture.engine,
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      name: values["real-model"] ? "fixture+real-model" : "fixture",
      ...(values["retrieval-only"] ? { retrievalOnly: true } : {}),
      onUnsupportedTerms: printUnsupportedTerms,
    }),
  };
}

async function buildJudge(): Promise<Judge> {
  // Nothing is graded in a retrieval-only run, so nothing is constructed: no
  // key is required and no provider SDK is loaded to sit unused.
  if (values.judge === "none" || values["retrieval-only"]) return createDeterministicJudge();
  if (values.judge !== "llm") fail(`unknown --judge ${values.judge}`);
  const { createJudgeDeps } = await import("../packages/core/src/models/index");
  const deps = createJudgeDeps();
  if (deps.modelId === deps.targetModelId) {
    console.error(
      `warning: the judge (${deps.modelId}) is the model being evaluated. A model marking its ` +
        "own homework shares the blind spot that produced the answer. Set DESKBELL_JUDGE_MODEL " +
        "to something else before quoting these numbers.",
    );
  }
  return createLlmJudge(deps);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    values.dataset ?? new URL("../packages/evals/datasets/fixture.json", import.meta.url).pathname,
  );
  const loaded = await loadDataset(datasetPath);

  const retrievalOnly = values["retrieval-only"] === true;
  if (retrievalOnly && (values.check || values["update-baseline"])) {
    fail(
      "--retrieval-only cannot be combined with --check or --update-baseline: it grades " +
        "nothing, so its baseline would overwrite the quality half of the record with nulls.",
    );
  }

  const { target, k, promptHash, retrievalConfig, resolveLabels } = await buildTarget();
  const judge = await buildJudge();

  // Before anything is asked: a labelling problem must stop the run, not show
  // up later as a retrieval regression that never happened.
  const dataset = resolveLabels ? await resolveLabels(loaded) : loaded;

  console.error(`${dataset.name}: ${describeBalance(dataset)}`);

  // Read before the run, not after: a malformed label file should cost seconds,
  // not a completed set of model calls.
  const humanGrades = values.labels
    ? parseHumanGrades(readFileSync(resolve(values.labels), "utf8"))
    : undefined;

  const report = await runEvals({
    dataset,
    target,
    judge,
    k: values.k ? Number(values.k) : k,
    ...(retrievalConfig === undefined ? {} : { retrievalConfig }),
    ...(promptHash === undefined ? {} : { promptHash }),
    ...(retrievalOnly ? { retrievalOnly: true } : {}),
    ...(humanGrades === undefined ? {} : { humanGrades }),
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
  });

  const markdown = renderMarkdown(report);
  console.log(markdown);

  if (values.json) write(values.json, renderJson(report));
  if (values.markdown) write(values.markdown, `${markdown}\n`);

  // A CI job summary is where these numbers are actually read, and it needs no
  // write permission on the repository the way a pull-request comment does.
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
  }

  const baselinePath = resolve(values.baseline ?? defaultBaselinePath(datasetPath, dataset.name));
  const current = toBaseline(report);

  if (values["update-baseline"]) {
    write(baselinePath, serializeBaseline(current));
    console.error(`\nbaseline written: ${baselinePath}`);
    return;
  }

  if (!values.check) return;

  let previous: Baseline;
  try {
    previous = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  } catch {
    fail(`no baseline at ${baselinePath} — create one with --update-baseline`);
  }

  const diff = compareToBaseline(current, previous);
  console.error(`\n${renderDiff(diff)}`);

  if (!diff.ok) {
    console.error(
      "\nThe eval gate is red. If this change was intended, re-run with --update-baseline and commit the new baseline as part of the same change.",
    );
    process.exitCode = 1;
  }
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), contents);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
