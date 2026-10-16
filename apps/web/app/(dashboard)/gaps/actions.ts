"use server";

import { createAnswerDrafterDeps, embeddingModelId } from "@deskbell/core/models";
import { gapClusters, messages, projects, recordUsage, tokensUsedToday } from "@deskbell/db";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import type { DraftResult } from "@/lib/answer-draft";
import { checkRole, requireRole } from "@/lib/auth/session";
import { enqueueAnalyzeGapCluster, enqueueGapsCatchup } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { loadDraftMaterial } from "@/lib/draft-material";
import { ANALYSIS_PENDING_TTL_MS, ANALYZE_ALL_CAP } from "@/lib/gaps";
import { getDefaultProject } from "@/lib/org";

/**
 * Cluster state changes from the gaps page (spec: gap-clusters). Every
 * write is scoped to the caller's org and project (D12); a cluster id from
 * another tenant matches nothing and changes nothing.
 */

async function setStatus(clusterId: string, status: "open" | "resolved"): Promise<void> {
  const { session } = await requireRole("editor");
  const project = await getDefaultProject();
  const db = getDb();
  await db
    .update(gapClusters)
    .set(
      status === "resolved"
        ? { status, resolvedAt: new Date(), resolvedBy: session.user.id, updatedAt: new Date() }
        : { status, resolvedAt: null, resolvedBy: null, reopenedAt: null, updatedAt: new Date() },
    )
    .where(
      and(
        eq(gapClusters.id, clusterId),
        eq(gapClusters.orgId, project.orgId),
        eq(gapClusters.projectId, project.id),
      ),
    );
  revalidatePath("/gaps");
  revalidatePath("/");
}

/** The docs now answer this; a later occurrence reopens it by itself. */
export async function resolveCluster(clusterId: string): Promise<void> {
  await setStatus(clusterId, "resolved");
}

export async function reopenCluster(clusterId: string): Promise<void> {
  await setStatus(clusterId, "open");
}

/**
 * Drop every cluster in the project and rebuild from the rows. Loses
 * resolved state on purpose: a resolved cluster is a statement about one
 * set of questions, and the rebuilt clusters are a different set. The way
 * to act on a threshold or embedding-model change.
 */
export async function reclusterProject(): Promise<void> {
  await requireRole("admin");
  const project = await getDefaultProject();
  const db = getDb();
  await db.transaction(async (tx) => {
    const owned = tx
      .select({ id: gapClusters.id })
      .from(gapClusters)
      .where(and(eq(gapClusters.orgId, project.orgId), eq(gapClusters.projectId, project.id)));
    await tx
      .update(messages)
      .set({ gapClusterId: null })
      .where(and(eq(messages.orgId, project.orgId), inArray(messages.gapClusterId, owned)));
    await tx
      .delete(gapClusters)
      .where(and(eq(gapClusters.orgId, project.orgId), eq(gapClusters.projectId, project.id)));
  });
  await enqueueGapsCatchup({ orgId: project.orgId, projectId: project.id });
  revalidatePath("/gaps");
  revalidatePath("/");
}

/** For the stale-model notice: what the worker would embed with right now. */
export async function configuredEmbeddingModel(): Promise<string> {
  return embeddingModelId();
}

async function requestAnalysis(clusterIds: string[]): Promise<void> {
  const { session } = await requireRole("editor");
  const project = await getDefaultProject();
  const db = getDb();
  for (const clusterId of clusterIds) {
    const [marked] = await db
      .update(gapClusters)
      .set({ analysisRequestedAt: new Date(), analysisRequestedBy: session.user.id })
      .where(
        and(
          eq(gapClusters.id, clusterId),
          eq(gapClusters.orgId, project.orgId),
          eq(gapClusters.projectId, project.id),
        ),
      )
      .returning({ id: gapClusters.id });
    if (!marked) continue;
    await enqueueAnalyzeGapCluster({
      orgId: project.orgId,
      projectId: project.id,
      clusterId,
      requestedBy: session.user.id,
    });
  }
  revalidatePath("/gaps");
}

/**
 * A finding and a recommendation for one cluster (spec: gap-analysis).
 * Editor, like re-indexing, which also spends tokens; the spend control is
 * the project's daily budget, which the worker checks.
 */
export async function analyzeCluster(clusterId: string): Promise<void> {
  await requestAnalysis([clusterId]);
}

/**
 * The clusters the page offered (spec: gap-analysis-feedback): the caller
 * names them, so the number on the button is the number sent, whatever the
 * period. Re-checked here — open, unanalysed, and not asked within the TTL —
 * because the page may be stale and a click must never spend twice. A
 * request the worker never answered is past the TTL and gets sent again.
 */
export async function analyzeOpenClusters(clusterIds: unknown): Promise<void> {
  await requireRole("editor");
  const ids = Array.isArray(clusterIds)
    ? clusterIds.filter((id): id is string => typeof id === "string").slice(0, ANALYZE_ALL_CAP)
    : [];
  if (ids.length === 0) return;
  const project = await getDefaultProject();
  const db = getDb();
  const rows = await db
    .select({ id: gapClusters.id })
    .from(gapClusters)
    .where(
      and(
        eq(gapClusters.orgId, project.orgId),
        eq(gapClusters.projectId, project.id),
        inArray(gapClusters.id, ids),
        eq(gapClusters.status, "open"),
        isNull(gapClusters.analysis),
        or(
          isNull(gapClusters.analysisRequestedAt),
          lt(gapClusters.analysisRequestedAt, new Date(Date.now() - ANALYSIS_PENDING_TTL_MS)),
        ),
      ),
    )
    .orderBy(desc(gapClusters.lastSeen))
    .limit(ANALYZE_ALL_CAP);
  await requestAnalysis(rows.map((r) => r.id));
}

/**
 * A draft of the answer for one cluster (spec: answer-drafting). Editor,
 * like analysis, which also spends tokens; the spend control is the same
 * daily budget, checked here because this one does not go through the
 * worker — a person is waiting at the textarea, so a queued job would mean
 * polling a form.
 *
 * Returns a result rather than throwing: every outcome is something the
 * form has to say, and the reasons are a union so the copy is not matched
 * on a message. Usage is recorded even when the call fails, because the
 * provider counts tokens before a timeout does.
 */
export async function draftAnswer(clusterId: string): Promise<DraftResult> {
  const gate = await checkRole("editor");
  if (gate.error || !gate.ctx) {
    return { ok: false, reason: "forbidden", message: gate.error ?? "Not allowed" };
  }
  if (typeof clusterId !== "string" || clusterId === "") {
    return { ok: false, reason: "missing", message: "No gap to draft from" };
  }

  const project = await getDefaultProject();
  const db = getDb();
  const material = await loadDraftMaterial(db, project, clusterId);
  if (!material) return { ok: false, reason: "missing", message: "That gap no longer exists" };

  const [row, usedToday] = await Promise.all([
    db
      .select({ limit: projects.dailyTokenBudget })
      .from(projects)
      .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)))
      .limit(1)
      .then(([p]) => p),
    tokensUsedToday(db, project.id, project.orgId),
  ]);
  const limit = row?.limit ?? 0;
  if (limit > 0 && usedToday >= limit) {
    return { ok: false, reason: "budget", message: "daily token budget reached" };
  }

  let usage = { input: 0, output: 0 };
  try {
    const drafter = createAnswerDrafterDeps();
    const draft = await drafter.draft(material, {
      onUsage: (u) => {
        usage = u;
      },
    });
    return { ok: true, answer: draft.answer, blanks: draft.blanks };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "model", message: message.slice(0, 300) };
  } finally {
    if (usage.input + usage.output > 0) {
      await recordUsage(db, {
        orgId: project.orgId,
        projectId: project.id,
        usage: { input: usage.input, output: usage.output, embedding: 0 },
      });
    }
  }
}
