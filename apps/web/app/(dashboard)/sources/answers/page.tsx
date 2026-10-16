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
import { ArrowLeft, Pencil, PenLine } from "lucide-react";
import Link from "next/link";

import { draftAnswer } from "@/app/(dashboard)/gaps/actions";
import { CorrectionDeleteButton } from "@/components/correction-delete-button";
import { CorrectionDrawer } from "@/components/correction-drawer";
import { PageHeader } from "@/components/page-header";
import { SiteHeader } from "@/components/site-header";
import { answerExcerpt } from "@/lib/corrections";
import { loadCorrections } from "@/lib/corrections-query";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/inbox";
import { getDefaultProject } from "@/lib/org";

import { deleteCorrection, saveCorrection } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Every written answer in the project (spec: written-answers-naming,
 * corrections-source), with the gap it was written for. Add, edit and
 * delete live here; the gaps page offers the same form for one cluster at
 * a time.
 */
export default async function WrittenAnswersPage() {
  const project = await getDefaultProject();
  const pairs = await loadCorrections(getDb(), project);

  return (
    <>
      <SiteHeader title="Written answers" />
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          title="Written answers"
          description="Answers you write yourself. Each one is indexed like a page and competes with your docs on the visitor's question, so write the question the way visitors ask it."
          actions={
            <>
              <Button asChild variant="ghost">
                <Link href="/sources">
                  <ArrowLeft />
                  Sources
                </Link>
              </Button>
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
            </>
          }
        />
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead>Gap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No written answers yet. Write one here, or answer a question on the Gaps page.
                  </TableCell>
                </TableRow>
              ) : (
                pairs.map((p) => (
                  <TableRow key={p.documentId} className="align-top">
                    <TableCell className="max-w-xs whitespace-normal font-medium">
                      {p.question}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                      {answerExcerpt(p.answer)}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {p.cluster ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/gaps?gap=${p.cluster.id}`}
                            className="hover:underline underline-offset-4"
                          >
                            {p.cluster.label}
                          </Link>
                          <Badge variant="outline" className="text-muted-foreground">
                            {p.cluster.status === "resolved" ? "Resolved" : "Open"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.indexing === "ready" ? "outline" : "secondary"}>
                        {p.indexing === "ready" ? "Indexed" : "Indexing…"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {relativeTime(p.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <CorrectionDrawer
                          title="Edit answer"
                          trigger={
                            <Button variant="ghost" size="sm">
                              <Pencil />
                              Edit
                            </Button>
                          }
                          form={{
                            action: saveCorrection,
                            documentId: p.documentId,
                            clusterId: p.cluster?.id,
                            // The form only offers it when there is a cluster
                            // to read (spec: answer-drafting).
                            draft: draftAnswer,
                            defaultQuestion: p.question,
                            defaultAnswer: p.answer,
                          }}
                        />
                        <CorrectionDeleteButton
                          question={p.question}
                          action={deleteCorrection.bind(null, p.documentId)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
