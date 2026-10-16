import { ACTION_CITATION_KIND, CORRECTIONS_SOURCE_TYPE } from "@deskbell/shared";

/**
 * How the dashboard names a cited source (spec: answer-citation-labels). A
 * page is its title. A written answer's title is the question it answers,
 * so it is marked as a written answer wherever it is listed; rows stored
 * before citations carried a kind fall back to the title alone.
 */

export const WRITTEN_ANSWER_LABEL = "Written answer";

export function isWrittenAnswer(citation: { kind?: string | null }): boolean {
  return citation.kind === CORRECTIONS_SOURCE_TYPE;
}

export const ACTION_LABEL = "Action";

/** A tool result the answer relied on (spec: mcp-actions); its title is the tool's label. */
export function isAction(citation: { kind?: string | null }): boolean {
  return citation.kind === ACTION_CITATION_KIND;
}

/** One cell's worth: the URL when there is one, else the title, marked when it is not a page. */
export function evidenceLabel(evidence: { title: string; url?: string; kind?: string }): string {
  if (evidence.url) return evidence.url;
  if (isWrittenAnswer(evidence)) return `written answer: ${evidence.title}`;
  if (isAction(evidence)) return `action: ${evidence.title}`;
  return evidence.title;
}
