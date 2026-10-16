import type { AnswerDraftInput } from "@deskbell/core/models";
import { type Database, gapClusters, gapQuestionSql, messages } from "@deskbell/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * What one cluster gives a drafter (spec: answer-drafting): its label, the
 * ways visitors phrased it, the passages the engine retrieved or cited, and
 * the analysis if it has run.
 *
 * The passages come from the citations column with their snippets, which
 * the page's own evidence list drops — the page needs a title to link, the
 * drafter needs the text. The tally matches the worker's, so the analyst
 * and the drafter read the same material in the same order.
 */

export const DRAFT_QUESTIONS = 8;
export const DRAFT_EVIDENCE = 6;

export async function loadDraftMaterial(
  db: Database,
  project: { id: string; orgId: string },
  clusterId: string,
): Promise<AnswerDraftInput | null> {
  const inProject = and(
    eq(gapClusters.orgId, project.orgId),
    eq(gapClusters.projectId, project.id),
    eq(gapClusters.id, clusterId),
  );
  const [cluster] = await db
    .select({ label: gapClusters.label, analysis: gapClusters.analysis })
    .from(gapClusters)
    .where(inProject)
    .limit(1);
  if (!cluster) return null;

  const [questionRows, citationRows] = await Promise.all([
    db
      .select({ question: gapQuestionSql, at: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.orgId, project.orgId), eq(messages.gapClusterId, clusterId)))
      .orderBy(sql`${messages.createdAt} asc`),
    db
      .select({ citations: messages.citations })
      .from(messages)
      .where(and(eq(messages.orgId, project.orgId), eq(messages.gapClusterId, clusterId))),
  ]);

  const seen = new Set<string>();
  const questions: string[] = [];
  for (const row of questionRows) {
    const text = (row.question ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    questions.push(text);
    if (questions.length >= DRAFT_QUESTIONS) break;
  }

  // Ranked by how many of the cluster's messages carried each document, the
  // same order the analyst reads them in.
  const tally = new Map<string, { title: string; url?: string; snippet: string; count: number }>();
  for (const row of citationRows) {
    const perMessage = new Set<string>();
    for (const c of row.citations ?? []) {
      if (!c || typeof c !== "object") continue;
      const { documentId, title, url, snippet } = c as Record<string, unknown>;
      if (typeof documentId !== "string" || typeof title !== "string" || perMessage.has(documentId))
        continue;
      perMessage.add(documentId);
      const entry = tally.get(documentId) ?? {
        title,
        ...(typeof url === "string" ? { url } : {}),
        snippet: typeof snippet === "string" ? snippet : "",
        count: 0,
      };
      entry.count += 1;
      tally.set(documentId, entry);
    }
  }
  const evidence = [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, DRAFT_EVIDENCE)
    .map(({ count: _count, ...e }) => e);

  const stored = cluster.analysis;
  return {
    question: cluster.label,
    questions: questions.length > 0 ? questions : [cluster.label],
    evidence,
    analysis: stored
      ? {
          finding: stored.finding,
          recommendation: stored.recommendation,
          suggestedFacts: stored.suggestedFacts,
        }
      : null,
  };
}
