"use server";

import { createVectorStore } from "@deskbell/core";
import { documents, gapClusters, sources } from "@deskbell/db";
import { CORRECTIONS_SOURCE_TYPE, newId } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole, requireRole } from "@/lib/auth/session";
import { enqueueIngestDocument } from "@/lib/boss";
import { contentHash, correctionContent, parseCorrectionForm } from "@/lib/corrections";
import { ensureCorrectionsSource } from "@/lib/corrections-query";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * Writing answers by hand (spec: corrections-source). An answer is a
 * document under the project's corrections source; saving replaces its
 * text and asks the worker to re-chunk it. Saving from a gap cluster also
 * resolves the cluster — on an edit too, since an edit after a reopen is
 * the operator saying the fix is in now. Every write is scoped to the
 * caller's org and project (D12).
 */

export interface CorrectionFormState {
  error?: string;
  /** Set on success; the timestamp lets a form tell one save from the next. */
  saved?: { documentId: string; at: number };
}

const PATHS = ["/sources/answers", "/sources", "/gaps", "/"] as const;

export async function saveCorrection(
  _prev: CorrectionFormState | undefined,
  formData: FormData,
): Promise<CorrectionFormState> {
  const gate = await checkRole("editor");
  if (gate.error || !gate.ctx) return { error: gate.error ?? "Not allowed" };
  const userId = gate.ctx.session.user.id;
  const parsed = parseCorrectionForm(formData);
  if (parsed.error || !parsed.data) return { error: parsed.error ?? "Invalid answer" };
  const { id, clusterId, question, answer } = parsed.data;

  const project = await getDefaultProject();
  const db = getDb();
  const source = await ensureCorrectionsSource(db, project);
  const content = correctionContent(question, answer);
  const now = new Date();

  const documentId = await db.transaction(async (tx) => {
    let savedId: string;
    if (id) {
      const [updated] = await tx
        .update(documents)
        .set({ title: question, content, contentHash: contentHash(content), updatedAt: now })
        .where(
          and(
            eq(documents.id, id),
            eq(documents.orgId, project.orgId),
            eq(documents.sourceId, source.id),
          ),
        )
        .returning({ id: documents.id });
      if (!updated) throw new Error("That answer no longer exists");
      savedId = updated.id;
    } else {
      savedId = newId("doc");
      await tx.insert(documents).values({
        id: savedId,
        orgId: project.orgId,
        sourceId: source.id,
        // Null on purpose: the citation schema takes a real URL or none.
        url: null,
        title: question,
        contentHash: contentHash(content),
        content,
      });
    }
    if (clusterId) {
      await tx
        .update(gapClusters)
        .set({
          correctionDocumentId: savedId,
          status: "resolved",
          resolvedAt: now,
          resolvedBy: userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(gapClusters.id, clusterId),
            eq(gapClusters.orgId, project.orgId),
            eq(gapClusters.projectId, project.id),
          ),
        );
    }
    // The same lifecycle as a crawl: pending now, ready when embed.chunks
    // finds nothing left to embed.
    await tx
      .update(sources)
      .set({ status: "pending", updatedAt: now })
      .where(and(eq(sources.id, source.id), eq(sources.orgId, project.orgId)));
    return savedId;
  });

  try {
    await enqueueIngestDocument({ orgId: project.orgId, sourceId: source.id, documentId });
  } catch (error) {
    // The text is saved; a re-index of the answers source re-sends it.
    console.error("[corrections] could not enqueue ingest.document", error);
  }
  for (const path of PATHS) revalidatePath(path);
  return { saved: { documentId, at: Date.now() } };
}

/**
 * Delete an answer. Chunks go with it by cascade and the cluster's pointer
 * goes null by the foreign key; the cluster's status is left alone — it is
 * a statement about the questions, and a new occurrence is what changes it.
 */
export async function deleteCorrection(documentId: string): Promise<void> {
  await requireRole("editor");
  const project = await getDefaultProject();
  const db = getDb();
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.orgId, project.orgId),
        eq(sources.projectId, project.id),
        eq(sources.type, CORRECTIONS_SOURCE_TYPE),
      ),
    )
    .limit(1);
  if (!source) return;
  const deleted = await db
    .delete(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.orgId, project.orgId),
        eq(documents.sourceId, source.id),
      ),
    )
    .returning({ id: documents.id });
  // The rows cascaded away with the document; a store with its own index
  // forgets them here (spec: weaviate-vector-store).
  if (deleted.length > 0) await createVectorStore(db).deleteByDocument(project.orgId, documentId);
  for (const path of PATHS) revalidatePath(path);
}
