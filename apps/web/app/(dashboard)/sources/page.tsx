import { vectorStoreId } from "@deskbell/core";
import { embeddingModelId } from "@deskbell/core/models";
import { chunks, documents, sources } from "@deskbell/db";
import { CORRECTIONS_SOURCE_TYPE } from "@deskbell/shared";
import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { and, count, desc, eq, isNotNull, ne } from "drizzle-orm";
import { PenLine, RefreshCw } from "lucide-react";
import Link from "next/link";

import { AddSourceForm } from "@/components/add-source-form";
import { CorrectionDrawer } from "@/components/correction-drawer";
import { PageHeader } from "@/components/page-header";
import { SiteHeader } from "@/components/site-header";
import { loadCorrections } from "@/lib/corrections-query";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/inbox";
import { getDefaultProject } from "@/lib/org";

import { reindexEmbeddings, syncSource } from "./actions";
import { saveCorrection } from "./answers/actions";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  syncing: "secondary",
  ready: "outline",
  error: "destructive",
};

function sourceUrl(config: Record<string, unknown>): string {
  return typeof config.url === "string" ? config.url : "—";
}

const TYPE_LABEL: Record<string, string> = {
  "docs-crawler": "Docs website",
};

/**
 * Two kinds of source, two sections (spec: written-answers-naming): the
 * websites the crawler reads, and the answers written in the dashboard. The
 * answers source is one row per project with no URL, so a table row said
 * nothing useful about it; the card says what an operator asks — how many,
 * are they indexed, when was the last one written.
 */
export default async function SourcesPage() {
  const project = await getDefaultProject();
  const db = getDb();
  const configuredModel = embeddingModelId();
  const configuredStore = vectorStoreId();
  const [rows, staleByModel, elsewhere, flaggedBySource, answers] = await Promise.all([
    db
      .select({ source: sources, docCount: count(documents.id) })
      .from(sources)
      .leftJoin(documents, eq(documents.sourceId, sources.id))
      .where(and(eq(sources.orgId, project.orgId), eq(sources.projectId, project.id)))
      .groupBy(sources.id)
      .orderBy(desc(sources.createdAt)),
    // Chunks embedded with anything other than the configured model. Non-empty
    // means the operator changed DESKBELL_EMBEDDING_MODEL and retrieval is
    // comparing vectors across models until a re-index runs.
    db
      .select({ model: chunks.embeddingModel, n: count() })
      .from(chunks)
      .where(
        and(
          eq(chunks.orgId, project.orgId),
          isNotNull(chunks.vectorStore),
          ne(chunks.embeddingModel, configuredModel),
        ),
      )
      .groupBy(chunks.embeddingModel),
    // Chunks whose vector sits in a store other than the configured one
    // (spec: vector-store-single-home). Non-empty means the operator changed
    // DESKBELL_VECTOR_STORE and retrieval searches an index those chunks are
    // not in until a re-index moves them.
    db
      .select({ store: chunks.vectorStore, n: count() })
      .from(chunks)
      .where(
        and(
          eq(chunks.orgId, project.orgId),
          isNotNull(chunks.vectorStore),
          ne(chunks.vectorStore, configuredStore),
        ),
      )
      .groupBy(chunks.vectorStore),
    // Chunks whose content matched an ingest-time injection heuristic
    // (spec: ingestion-pipeline). Flagged, not filtered — they still answer;
    // this is the operator's view of what was flagged and where.
    db
      .select({ sourceId: documents.sourceId, n: count() })
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(eq(chunks.orgId, project.orgId), isNotNull(chunks.injectionSignals)))
      .groupBy(documents.sourceId),
    loadCorrections(db, project),
  ]);
  const staleCount = staleByModel.reduce((sum, r) => sum + r.n, 0);
  const staleModels = staleByModel.flatMap((r) => (r.model ? [r.model] : []));
  const elsewhereCount = elsewhere.reduce((sum, r) => sum + r.n, 0);
  const elsewhereStores = elsewhere.flatMap((r) => (r.store ? [r.store] : []));
  const flaggedCounts = new Map(flaggedBySource.map((r) => [r.sourceId, r.n]));
  const websites = rows.filter(({ source }) => source.type !== CORRECTIONS_SOURCE_TYPE);
  const answersSource = rows.find(({ source }) => source.type === CORRECTIONS_SOURCE_TYPE)?.source;
  const indexing = answers.filter((a) => a.indexing !== "ready").length;
  const lastWritten = answers[0]?.updatedAt;
  const answersFlagged = answersSource ? (flaggedCounts.get(answersSource.id) ?? 0) : 0;

  return (
    <>
      <SiteHeader title="Sources" />
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          title="Sources"
          description="Content the agent answers from: the websites you crawl and the answers you write. Both are chunked and embedded the same way and compete on the visitor's question."
        />
        <section aria-labelledby="sources-websites" className="flex flex-col gap-4">
          <h2 id="sources-websites" className="text-lg font-semibold tracking-tight">
            Websites
          </h2>
          <AddSourceForm />
          {elsewhereCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Vector store changed</p>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {elsewhereCount} chunks are indexed in{" "}
                  {elsewhereStores.join(", ") || "another store"} but this deployment is configured
                  for {configuredStore}. Retrieval searches the configured store, so these chunks
                  cannot be found until they are re-embedded into it.
                </p>
              </div>
              <form action={reindexEmbeddings}>
                <Button type="submit" variant="outline">
                  Re-embed all content
                </Button>
              </form>
            </div>
          ) : null}
          {staleCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Embedding model changed</p>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {staleCount} chunks are embedded with {staleModels.join(", ") || "an older model"}{" "}
                  but this deployment is configured for {configuredModel}. Until they are
                  re-embedded, retrieval compares vectors from different models and answers quietly
                  degrade.
                </p>
              </div>
              <form action={reindexEmbeddings}>
                <Button type="submit" variant="outline">
                  Re-embed all content
                </Button>
              </form>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead>Last synced</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {websites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No websites yet — add your docs site above.
                    </TableCell>
                  </TableRow>
                ) : (
                  websites.map(({ source, docCount }) => (
                    <TableRow key={source.id}>
                      <TableCell>
                        <Badge variant="outline">{TYPE_LABEL[source.type] ?? source.type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate font-mono text-xs">
                        {sourceUrl(source.config)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant[source.status] ?? "secondary"}>
                            {source.status}
                          </Badge>
                          {(flaggedCounts.get(source.id) ?? 0) > 0 ? (
                            <Badge
                              variant="destructive"
                              title="Chunks whose content looks like instructions aimed at the assistant (prompt injection). They still answer — review the pages and decide."
                            >
                              {flaggedCounts.get(source.id)} flagged
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{docCount}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {source.lastSyncedAt
                          ? new Date(source.lastSyncedAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <form action={syncSource.bind(null, source.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            type="submit"
                            disabled={source.status === "syncing"}
                          >
                            <RefreshCw />
                            Sync
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
        <section aria-labelledby="sources-answers" className="flex flex-col gap-4">
          <h2 id="sources-answers" className="text-lg font-semibold tracking-tight">
            Written answers
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {answers.length === 0
                  ? "No written answers yet"
                  : `${answers.length} ${answers.length === 1 ? "answer" : "answers"}`}
              </p>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {answers.length === 0
                  ? "Answer a question in your own words. It is indexed like a page and cited as a written answer."
                  : [
                      indexing > 0 ? `${indexing} indexing` : "All indexed",
                      lastWritten ? `last written ${relativeTime(lastWritten)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
              {answersFlagged > 0 ? (
                <Badge
                  variant="destructive"
                  className="w-fit"
                  title="Answers whose text looks like instructions aimed at the assistant (prompt injection). They still answer — review them and decide."
                >
                  {answersFlagged} flagged
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {answersSource && answers.length > 0 ? (
                <form action={syncSource.bind(null, answersSource.id)}>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={answersSource.status === "syncing"}
                  >
                    <RefreshCw />
                    Re-index
                  </Button>
                </form>
              ) : null}
              <CorrectionDrawer
                title="Write an answer"
                description="The question as visitors ask it, and what the assistant should say."
                trigger={
                  <Button>
                    <PenLine />
                    Write an answer
                  </Button>
                }
                form={{ action: saveCorrection }}
              />
              <Button asChild variant="ghost">
                <Link href="/sources/answers">Manage</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
