import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDefaultProject } from "@/lib/org";

import { VisitorDataForm } from "./visitor-data-form";

export const dynamic = "force-dynamic";

/**
 * Visitor data (spec: own-data-fallback): what the assistant says when a visitor
 * asks about their own account and the content alone cannot answer. The
 * widget answers from your pages, and on a turn with no connected action it
 * cannot see the visitor's data; without a reply of yours it either refuses
 * or writes a diagnosis as if it had looked.
 */
export default async function VisitorDataPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";

  return (
    <>
      <PageHeader
        title="Visitor data"
        description={
          <>
            The assistant answers from your content. When a visitor asks about their own account,
            their settings, their records, why something of theirs behaves as it does, and no
            connected action can look it up, it shows the reply below instead of guessing. These
            replies are counted on the Conversations page as{" "}
            <strong>No access to visitor data</strong> and never appear on the Gaps page.
          </>
        }
      />
      <VisitorDataForm answering={project.answering} canEdit={canEdit} />
    </>
  );
}
