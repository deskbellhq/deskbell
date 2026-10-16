import { countConversationsPastRetentionFor } from "@deskbell/db";
import { CONVERSATION_RETENTION_PRESETS } from "@deskbell/shared";

import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { RetentionForm } from "./retention-form";

export const dynamic = "force-dynamic";

/**
 * Data retention (spec: conversation-retention): how long a conversation
 * with no new message is kept before the hourly job removes it. The counts
 * for every preset are computed here in one query so choosing one costs no
 * round trip; only a custom number asks the server.
 */
export default async function RetentionPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";
  const scope = { orgId: project.orgId, projectId: project.id };
  const current = project.conversationRetentionDays;
  const windows = [...new Set<number>([...CONVERSATION_RETENTION_PRESETS, current])];
  const counts = await countConversationsPastRetentionFor(getDb(), scope, windows);

  return (
    <>
      <PageHeader
        title="Data retention"
        description={
          <>
            How long a conversation is kept after its last message. Past the window, the hourly job
            removes it with its messages, citations, feedback and tool calls, and it leaves the
            visitor&apos;s thread list. Everything else stays: sources, written answers, gap
            clusters and visitor profiles.
          </>
        }
      />
      <RetentionForm
        days={current}
        counts={counts}
        canEdit={canEdit}
        lastRun={
          project.conversationsPurgedAt
            ? {
                at: project.conversationsPurgedAt.toISOString(),
                removed: project.conversationsPurgedCount,
              }
            : null
        }
      />
    </>
  );
}
