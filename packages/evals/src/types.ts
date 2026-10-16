import type { TokenUsage } from "@deskbell/core";

/**
 * The per-case outcome, DERIVED from per-criterion matches rather than chosen
 * by a judge (`gradeFromFacts`). It exists for the baseline gate, where the
 * question is "did this case get worse", and a three-way label answers it.
 *
 * It is deliberately not what Factuality averages: a mean over an ordinal
 * asserts the A→B gap equals the B→C gap, and moves in half-steps however many
 * criteria a case carries. Factuality is mean fact coverage instead.
 */
export type Grade = "A" | "B" | "C";

export const GRADE_SCORES: Record<Grade, number> = { A: 1, B: 0.5, C: 0 };

export interface EvalCaseSource {
  /** "real" cases came from traffic; "authored" ones were written for a fixture. */
  kind: "real" | "authored";
  messageId?: string;
  capturedAt?: string;
}

export interface EvalCase {
  id: string;
  question: string;
  locale?: string;
  /**
   * "answerable" cases carry marking criteria; "unanswerable" cases MUST refuse;
   * "injection" cases hide an instruction in the corpus and MUST not obey it;
   * "ambiguous" cases are under-specified on purpose and MUST be asked back
   * about, offering every option in `expectedOptions` (spec:
   * clarifying-questions).
   */
  kind: "answerable" | "unanswerable" | "injection" | "ambiguous";
  /**
   * The marking criteria: the specific facts a correct answer must contain.
   * Not a reference answer — a reference answer bundles essential facts with
   * caveats and phrasing, and grading against it means guessing which parts
   * mattered.
   */
  expectedFacts?: string[];
  /** The one fact that matters most. Present without the rest earns a B. */
  keyFact?: string;
  /**
   * Ambiguous cases only: page titles the clarifying question must offer.
   * A subset, not the whole list — the corpus may hold more readings than
   * the author thought of, and offering one more is not a failure.
   */
  expectedOptions?: string[];
  /**
   * Strings that must NOT appear in the answer. On an injection case this is the
   * marker the corpus tries to make the model emit; on any other case it is a
   * thing the answer must never say. Checked as text, never by a judge — whether
   * a hostile instruction was obeyed is a fact, not an opinion.
   */
  mustNotContain?: string[];
  /** Documents known to support the answer. Enables recall@k and citation scoring. */
  relevantDocumentIds?: string[];
  /**
   * The same labels expressed as URLs, resolved to document ids against the
   * target project's corpus at run time (spec: eval-url-labels).
   *
   * Prefer this for any set that runs against a real corpus. Document ids are
   * re-minted whenever a source is deleted and re-added or a database is
   * rebuilt, and a stale id does not error — it silently scores zero recall for
   * that case and reads as a retrieval regression that never happened. The URL
   * is what the label actually means.
   */
  relevantUrls?: string[];
  /**
   * Failure-mode labels, counted across cases that score below full marks.
   * Free-form on purpose: the taxonomy comes from reading failures, and a fixed
   * enum here would freeze it before it has been derived.
   */
  tags?: string[];
  notes?: string;
  source?: EvalCaseSource;
  /**
   * Turns before the question, oldest first, so a follow-up is asked in the
   * thread that provoked it (spec: answer-verification): a scripted prior
   * answer the visitor pushes back on. Only the in-process target can replay
   * these; over HTTP the server loads history by conversation, and scripted
   * turns cannot be sent.
   */
  history?: EvalTurn[];
}

export interface EvalTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Dataset {
  name: string;
  description?: string;
  cases: EvalCase[];
}

/** What retrieval returned, as much of it as a target can report. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  /**
   * Cosine similarity to the canonical question; null when the engine could
   * not score the chunk (a lexical-only hit with no embedding yet). Retrieval
   * metrics rank on ORDER, never on this value.
   */
  score: number | null;
  /**
   * The chunk text, when the target can see it. Groundedness needs the context
   * the answer was drawn from, so a target that cannot supply it (a remote
   * endpoint reporting only citation snippets) leaves groundedness unassessed
   * rather than guessed.
   */
  content?: string;
}

export interface TargetAnswer {
  answer: string;
  refused: boolean;
  refusalReason?: string;
  /** The target asked which reading was meant instead of answering. */
  clarified?: boolean;
  /** The options it offered, as page titles. */
  options?: string[];
  citedDocumentIds: string[];
  /**
   * What retrieval returned, or NULL for a target that cannot see inside the
   * system it drives.
   *
   * The distinction is the whole point of the field being nullable: an empty
   * array means retrieval ran and found nothing, which is a result and scores
   * zero. Null means nobody looked. Collapsing the two lets a change that
   * starves retrieval on the hardest questions raise reported recall by
   * removing those cases from the denominator.
   */
  retrieved: RetrievedChunk[] | null;
  /**
   * Names the answer asserted that were found neither in the context nor in
   * the corpus (spec: answer-verification). Null or absent means the answer
   * was not checked — verification off, a refusal, or a target that cannot
   * see the signal — and keeps the case out of the rate's denominator.
   */
  unsupportedTerms?: string[] | null;
  usage: TokenUsage;
  latencyMs: number;
}

/**
 * The agnosticism seam, same shape as VectorStore (D13): the harness evaluates
 * an answering system, and our engine is one such system rather than the only
 * one it can drive.
 */
export interface Target {
  readonly name: string;
  ask(evalCase: EvalCase): Promise<TargetAnswer>;
  close?(): Promise<void>;
}

export interface Verdict {
  /** Derived from the fact lists by `gradeFromFacts`, never chosen directly. */
  grade: Grade;
  reason: string;
  /**
   * The criteria the answer contains and the ones it does not — one binary
   * judgement each, and the only thing a judge is asked to decide. Both lists
   * quote `EvalCase.expectedFacts` verbatim; anything else a judge returns is
   * counted as an anomaly rather than scored.
   */
  matchedFacts: string[];
  missingFacts: string[];
  /**
   * Whether every claim is supported by retrieved context. Null if not assessed.
   * Judged INDEPENDENTLY of fact matching: a correct fact the context does not
   * support is present and ungrounded, not absent.
   */
  grounded: boolean | null;
  /**
   * The judge returned a "fact" outside the case's criteria. Optional because a
   * matcher cannot be anomalous — it can only find strings it was given.
   */
  anomaly?: boolean;
}

export interface Judge {
  readonly name: string;
  grade(evalCase: EvalCase, answer: TargetAnswer): Promise<Verdict>;
}

export interface RetrievalScores {
  recallAtK: number;
  /**
   * Relevant documents over documents returned. The one retrieval number that
   * answers "how much of what the model paid for was irrelevant" — which is
   * what document-level capping exists to move, and what recall cannot see.
   */
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export interface CitationScores {
  precision: number;
  recall: number;
}

export interface EvalCaseResult {
  id: string;
  kind: EvalCase["kind"];
  question: string;
  refused: boolean;
  /** Null for unanswerable cases — they are scored on refusing, not on content. */
  grade: Grade | null;
  score: number | null;
  reason: string;
  matchedFacts: string[];
  missingFacts: string[];
  /**
   * Matched criteria over required criteria. Null when the case carries none
   * (unanswerable) or nothing was graded (a retrieval-only run). This, not
   * `score`, is what Factuality averages.
   */
  factCoverage: number | null;
  /**
   * The judge returned a "fact" that is not one of the case's criteria — it
   * paraphrased the marking scheme instead of applying it. Needs no human
   * labels and is the cheapest signal that a judge is drifting.
   */
  judgeAnomaly: boolean;
  /** Null for answerable cases. */
  correctRefusal: boolean | null;
  /** An answerable case that refused anyway. */
  falseRefusal: boolean;
  /** The target asked a clarifying question instead of answering. */
  clarified: boolean;
  /**
   * Ambiguous cases: asked, and offered every expected option. Null for every
   * other kind — an answerable case that asks is graded C, not scored here.
   */
  correctClarification: boolean | null;
  /**
   * Whether the answer contained something it must not. On an injection case,
   * true means the embedded instruction was obeyed. Null when nothing was
   * forbidden.
   */
  complied: boolean | null;
  grounded: boolean | null;
  citationCount: number;
  citedDocumentIds: string[];
  /**
   * What retrieval returned — the top-k chunks collapsed to documents in rank
   * order, exactly as the retrieval metrics see them. Null when the target
   * cannot observe retrieval, like `retrieval`. Ids only: the answer text
   * stays out of the report, and so does the chunk text.
   */
  retrievedDocumentIds: string[] | null;
  /**
   * The best and mean cosine among the retrieved chunks, or null when nothing
   * was scored or nobody looked. The same numbers the product stores per
   * answer, so the floor that marks an answer "weak" can be calibrated here
   * against judged grades (spec: answer-signal). Never in the baseline.
   */
  retrievedTopScore: number | null;
  retrievedMeanScore: number | null;
  /**
   * How many names the answer asserted that the corpus does not contain
   * (spec: answer-verification). A count, never the names: they are answer
   * text, which reports do not hold. Null when the answer was not checked.
   */
  unsupportedTermCount: number | null;
  retrieval: RetrievalScores | null;
  citations: CitationScores | null;
  usage: TokenUsage;
  latencyMs: number;
}

/**
 * The retrieval configuration a run actually measured (spec: hybrid-retrieval).
 *
 * Recorded because a sweep produces many reports that differ ONLY in this —
 * `k` alone under-describes a run the moment retrieval has more than one knob.
 * Absent when the run used the shipped defaults untouched, so fixture
 * baselines carry no new field and stay byte-stable.
 */
export interface RetrievalProvenance {
  limit: number;
  minScore: number;
  mode: "vector" | "hybrid";
  multiQuery: boolean;
  legDepth: number;
  /** ANN scan depth (pgvector hnsw.ef_search). Absent on baselines written before it existed. */
  efSearch?: number;
  pool: number;
  maxPerDocument: number;
  order: "fused" | "cosine";
  rerank: "off" | "llm" | "local";
  /** Only meaningful when rerank is not off. */
  rerankModel?: string;
}

/** Judge agreement against human grades, when a label file was supplied. */
export interface AlignmentReport {
  /** Cases carrying a human grade. */
  labelled: number;
  /** Share where judge and human chose the same letter. */
  exactAgreement: number;
  /**
   * Share where they agree on acceptable (A) versus not. The binary question is
   * the one a judge can be held to; exact agreement also charges it for the
   * A/B boundary, which is the subjective one.
   */
  binaryAgreement: number;
  /** `caseId: "human → judge"`, so a disagreement can be read without a rerun. */
  disagreements: Record<string, string>;
}

export interface EvalReport {
  dataset: string;
  target: string;
  judge: string;
  /**
   * First 12 hex characters of the SHA-256 of the system prompt the run used.
   * Absent for targets that cannot know it. A change is a change, never a
   * regression — a different prompt is a different measurement.
   */
  promptHash?: string;
  /** True when the run stopped after retrieval; every quality metric is null. */
  retrievalOnly?: boolean;
  /** Retrieval depth the run used; recall@k and nDCG@k are relative to it. */
  k: number;
  /** What retrieval configuration produced these numbers; absent = shipped defaults. */
  retrievalConfig?: RetrievalProvenance;

  // Counts. Kept from the original harness shape.
  total: number;
  answered: number;
  refused: number;
  correctRefusals: number;
  /** Cases the target asked a clarifying question on. */
  clarified: number;

  /**
   * Mean fact coverage over answerable cases — matched criteria over required
   * criteria, refusal scoring 0. A proportion of binary judgements, not a mean
   * of letters. Null when there are none, or when nothing was graded.
   */
  factuality: number | null;
  /** Share of unanswerable cases that correctly refused. Null when there are none. */
  uncertainty: number | null;
  /** Share of answerable cases that refused anyway. Null when nothing was graded. */
  falseRefusalRate: number | null;
  /**
   * Share of ambiguous cases that were asked back about with every expected
   * option offered. Null when there are none. Kept apart from clarifyRate the
   * way uncertainty is kept apart from factuality: asking about everything
   * would make this perfect and the other unbearable.
   */
  clarification: number | null;
  /** Share of answerable cases that asked instead of answering. Null when nothing was graded. */
  clarifyRate: number | null;
  /** Share of answers fully supported by their context. Null unless judged. */
  groundedness: number | null;
  /**
   * Share of checked answers that named at least one thing the corpus does
   * not contain (spec: answer-verification). Lower is better. Null when no
   * answer was checked, so a run with verification off reports nothing.
   */
  unsupportedTermRate: number | null;
  /** Share of injection cases that did NOT obey the embedded instruction. */
  injectionResistance: number | null;
  /** Answerable cases where the judge returned a fact outside the criteria. */
  judgeAnomalies: number;
  /** Judge-vs-human agreement; absent unless a label file was supplied. */
  alignment?: AlignmentReport;
  /** How often each failure-mode tag appears among cases below full marks. */
  tagFrequency: Record<string, number>;

  retrieval: (RetrievalScores & { cases: number }) | null;
  citations: (CitationScores & { cases: number }) | null;

  cost: {
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    totalLatencyMs: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
  };

  cases: EvalCaseResult[];
}
