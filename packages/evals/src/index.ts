/**
 * D8: the harness replays a question set against an answering system, judges
 * the answers against marking criteria, and reports two headline numbers —
 * factuality and uncertainty — plus retrieval, citation and cost detail.
 *
 * Without it, a retrieval change cannot be told apart from a regression.
 * Cross-language cases (PL docs / DE question) belong in the default set once
 * a real one exists (D12: multilingual by default).
 */

export { type HumanGrades, parseHumanGrades, scoreAlignment } from "./alignment";
export {
  type Baseline,
  type BaselineDiff,
  compareToBaseline,
  defaultBaselinePath,
  type Outcome,
  renderDiff,
  serializeBaseline,
  toBaseline,
} from "./baseline";
export { DatasetSchema, describeBalance, loadDataset, parseDataset, splitByKind } from "./dataset";
export {
  createDeterministicJudge,
  createLlmJudge,
  factCoverage,
  gradeFromFacts,
  judgeName,
  type LlmJudgeDeps,
} from "./judge";
export { scoreCitations } from "./metrics/citations";
export { rankedDocuments, scoreRetrieval } from "./metrics/retrieval";
export {
  clarification,
  clarifyRate,
  factuality,
  falseRefusalRate,
  groundedness,
  injectionResistance,
  percentile,
  uncertainty,
} from "./metrics/scores";
export { promptFingerprint } from "./prompt";
export { renderJson, renderMarkdown } from "./report";
export { type RunOptions, runEvals } from "./run";
export {
  createEngineTarget,
  createHttpTarget,
  type EngineTargetOptions,
  type HttpTargetOptions,
} from "./target";
export type {
  AlignmentReport,
  CitationScores,
  Dataset,
  EvalCase,
  EvalCaseResult,
  EvalCaseSource,
  EvalReport,
  Grade,
  Judge,
  RetrievalProvenance,
  RetrievalScores,
  RetrievedChunk,
  Target,
  TargetAnswer,
  Verdict,
} from "./types";
export { GRADE_SCORES } from "./types";
