import type { CitationScores } from "../types";

/**
 * Citations vs the documents that actually support the answer.
 *
 * The engine asks the model to name the context blocks it used and cites only
 * those (spec: grounded-generation), so this measures citing behaviour rather
 * than retrieval depth. Two caveats travel with the number. Against a generator
 * that cites by construction — the fixture's is extractive — it measures the
 * plumbing, not a judgement. And when a model names nothing usable the engine
 * falls back to the retrieved set, which is the old behaviour and reads here as
 * a precision floor rather than as the failure it is.
 */
export function scoreCitations(
  citedDocumentIds: string[],
  relevantDocumentIds: string[],
): CitationScores | null {
  if (relevantDocumentIds.length === 0) return null;

  const relevant = new Set(relevantDocumentIds);
  const cited = [...new Set(citedDocumentIds)];
  const hits = cited.filter((id) => relevant.has(id)).length;

  return {
    precision: cited.length === 0 ? 0 : hits / cited.length,
    recall: hits / relevant.size,
  };
}
