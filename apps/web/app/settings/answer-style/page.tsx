import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDefaultProject } from "@/lib/org";

import { AnswerStyleForm } from "./answer-style-form";

export const dynamic = "force-dynamic";

/**
 * Answer style (spec: answer-style): the project's own paragraph on how the
 * assistant should sound, appended to the instruction the model reads after
 * everything that decides what it may say. Tone, length, address and
 * language belong here; what the assistant knows does not, which the
 * description says in as many words.
 */
export default async function AnswerStylePage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";

  return (
    <>
      <PageHeader
        title="Answer style"
        description={
          <>
            How the assistant sounds: tone, length, how it addresses the visitor, which language it
            answers in. It is added to the instruction the model reads, after the rules that keep
            answers grounded in your content. It does not add knowledge — put facts in your sources
            or a written answer, where they get cited.
          </>
        }
      />
      <AnswerStyleForm answerStyle={project.answerStyle} canEdit={canEdit} />
    </>
  );
}
