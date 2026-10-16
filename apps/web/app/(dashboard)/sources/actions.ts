"use server";

import { connectorRegistry } from "@deskbell/connectors";
import { embeddingModelId } from "@deskbell/core/models";
import { chunks, sources } from "@deskbell/db";
import { newId } from "@deskbell/shared";
import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole, requireRole } from "@/lib/auth/session";
import { enqueueIngestSource, enqueueReindexEmbeddings } from "@/lib/boss";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

export async function addDocsSource(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const gate = await checkRole("editor");
  if (gate.error) return { error: gate.error };
  const url = String(formData.get("url") ?? "").trim();
  const maxPagesRaw = String(formData.get("maxPages") ?? "").trim();
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : 50;

  const connector = connectorRegistry.get("docs-crawler");
  if (!connector) return { error: "docs-crawler connector is not registered" };
  const parsed = connector.configSchema.safeParse({ url, maxPages });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid source config" };
  }

  const project = await getDefaultProject();
  const sourceId = newId("src");
  await getDb()
    .insert(sources)
    .values({
      id: sourceId,
      orgId: project.orgId,
      projectId: project.id,
      type: "docs-crawler",
      config: parsed.data as Record<string, unknown>,
      status: "pending",
    });
  await enqueueIngestSource({ orgId: project.orgId, sourceId });
  revalidatePath("/sources");
  // The getting-started page renders this form too, and nothing polls it
  // before a source exists (spec: overview-getting-started).
  revalidatePath("/");
  return {};
}

export async function syncSource(sourceId: string): Promise<void> {
  await requireRole("editor");
  const project = await getDefaultProject();
  const db = getDb();
  const source = await db.query.sources.findFirst({
    where: and(eq(sources.id, sourceId), eq(sources.orgId, project.orgId)),
  });
  if (!source) return;
  await db
    .update(sources)
    .set({ status: "pending", updatedAt: new Date() })
    .where(eq(sources.id, source.id));
  await enqueueIngestSource({ orgId: project.orgId, sourceId: source.id });
  revalidatePath("/sources");
  revalidatePath("/");
}

/**
 * Re-embed the org's chunks with the configured embedding model (spec:
 * ingestion-pipeline). The supported way to act on a DESKBELL_EMBEDDING_MODEL
 * change — the alternative is a queue name found by reading the source.
 */
export async function reindexEmbeddings(): Promise<void> {
  await requireRole("editor");
  const project = await getDefaultProject();
  const db = getDb();
  // Target = one past the org's highest generation, so "version < target"
  // selects every existing row whatever mix of generations it holds — and
  // rows the job completes stop matching, which is what makes it resumable.
  const [current] = await db
    .select({ v: max(chunks.embeddingVersion) })
    .from(chunks)
    .where(eq(chunks.orgId, project.orgId));
  await enqueueReindexEmbeddings({
    orgId: project.orgId,
    targetModel: embeddingModelId(),
    targetVersion: (current?.v ?? 1) + 1,
  });
  revalidatePath("/sources");
}
