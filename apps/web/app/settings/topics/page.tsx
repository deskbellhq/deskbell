import { conversations, messages } from "@deskbell/db";
import { and, count, eq, isNotNull } from "drizzle-orm";

import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { RelabelButton } from "./relabel-button";
import { TopicsForm } from "./topics-form";

export const dynamic = "force-dynamic";

/**
 * Question topics (spec: question-topics): the list the worker labels each
 * visitor question against, and the Usage page groups by. The operator's
 * vocabulary, not the server's — an empty list means no labelling.
 */
export default async function TopicsSettingsPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";
  const [row] = await getDb()
    .select({ labelled: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.orgId, project.orgId),
        eq(conversations.projectId, project.id),
        eq(messages.role, "user"),
        isNotNull(messages.topic),
      ),
    );
  const labelled = row?.labelled ?? 0;

  return (
    <>
      <PageHeader
        title="Topics"
        description={
          <>
            What visitors ask about, in your words. Each question is labelled with one topic by the
            chat model as it comes in, and the Usage page counts questions by topic. The description
            tells the model what belongs in a topic — write it as a rule.
          </>
        }
      />
      <TopicsForm topics={project.topics} canEdit={canEdit} />
      {canEdit && project.topics.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <div className="max-w-md">
            <h2 className="text-sm font-medium">Apply to existing questions</h2>
            <p className="text-sm text-muted-foreground">
              A saved list applies to questions asked from now on. Re-labelling writes new labels
              for the {labelled} {labelled === 1 ? "question" : "questions"} already labelled, and
              labels the rest.
            </p>
          </div>
          <RelabelButton labelled={labelled} />
        </div>
      ) : null}
    </>
  );
}
