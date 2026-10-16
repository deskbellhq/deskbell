import type { RetrievalScores, RetrievedChunk } from "../types";

/**
 * Collapses the top-k retrieved chunks to documents in rank order: several
 * chunks of one document are one hit, ranked at the best position any of them
 * reached. Shared by the metrics and the report row so the two cannot
 * disagree about what "retrieved" means.
 */
export function rankedDocuments(retrieved: RetrievedChunk[], k: number): string[] {
  const rankedDocs: string[] = [];
  for (const chunk of retrieved.slice(0, k)) {
    if (!rankedDocs.includes(chunk.documentId)) rankedDocs.push(chunk.documentId);
  }
  return rankedDocs;
}

/**
 * Binary-relevance retrieval metrics over the documents a case declares
 * relevant. Scored on what retrieval actually returned through the engine's
 * own path — not a separate query — so the numbers describe the product.
 */
export function scoreRetrieval(
  retrieved: RetrievedChunk[],
  relevantDocumentIds: string[],
  k: number,
): RetrievalScores | null {
  if (relevantDocumentIds.length === 0) return null;

  const relevant = new Set(relevantDocumentIds);
  const rankedDocs = rankedDocuments(retrieved, k);

  const found = rankedDocs.filter((id) => relevant.has(id));
  const recallAtK = found.length / relevant.size;
  // Over documents returned, not over k: k bounds chunks, and several chunks of
  // one page are one document in front of the reader.
  const precisionAtK = rankedDocs.length === 0 ? 0 : found.length / rankedDocs.length;

  const firstRank = rankedDocs.findIndex((id) => relevant.has(id));
  const mrr = firstRank === -1 ? 0 : 1 / (firstRank + 1);

  let dcg = 0;
  for (const [i, id] of rankedDocs.entries()) {
    if (relevant.has(id)) dcg += 1 / Math.log2(i + 2);
  }
  // The ideal runs over min(relevant, k): k bounds chunks and a document
  // occupies at least one, so it is a true bound on the documents a perfect
  // ranking could surface.
  let idcg = 0;
  for (let i = 0; i < Math.min(relevant.size, k); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  const ndcgAtK = idcg === 0 ? 0 : dcg / idcg;

  return { recallAtK, precisionAtK, mrr, ndcgAtK };
}
