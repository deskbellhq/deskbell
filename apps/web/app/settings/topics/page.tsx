import { conversations, messages } from "@deskbell/db";
import { and, count, eq, isNotNull } from "drizzle-orm";

import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { LabellingSwitch } from "./labelling-switch";
import { RelabelButton } from "./relabel-button";
import { TopicsForm } from "./topics-form";

export const dynamic = "force-dynamic";

/**
 * Question topics and the labelling switch (spec: question-topics,
 * intent-and-signals): whether the worker labels each visitor question at
 * all, and the topic list it labels against. Intent and signals are fixed
 * lists and need no page; the topics are the operator's vocabulary.
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
        isNotNull(messages.intent),
      ),
    );
  const labelled = row?.labelled ?? 0;

  return (
    <>
      <PageHeader
        title="Topics"
        description={
          <>
            Each question is labelled by the chat model as it comes in: why it was asked, how it
            went, and which of your topics it belongs to. The Usage page counts questions by each.
          </>
        }
      />
      <LabellingSwitch on={project.classifyQuestions} canEdit={canEdit} />
      <div className="flex flex-col gap-6 border-t pt-6">
        <div className="max-w-xl">
          <h2 className="text-sm font-medium">Topics</h2>
          <p className="text-sm text-muted-foreground">
            What visitors ask about, in your words. Each question gets one topic from this list; the
            description tells the model what belongs in a topic, so write it as a rule.
          </p>
        </div>
        <TopicsForm topics={project.topics} canEdit={canEdit} />
      </div>
      {canEdit && project.classifyQuestions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <div className="max-w-md">
            <h2 className="text-sm font-medium">Apply to existing questions</h2>
            <p className="text-sm text-muted-foreground">
              A saved list applies to questions asked from now on. Re-labelling clears the topic,
              intent and signals of the {labelled} {labelled === 1 ? "question" : "questions"}{" "}
              already labelled and labels every question again.
            </p>
          </div>
          <RelabelButton labelled={labelled} />
        </div>
      ) : null}
    </>
  );
}
