import { organizations } from "@deskbell/db";
import { eq } from "drizzle-orm";

import { reclusterProject } from "@/app/(dashboard)/gaps/actions";
import { PageHeader } from "@/components/page-header";
import { ReclusterButton } from "@/components/recluster-button";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

import { GapSettingsForm } from "./gap-settings-form";

export const dynamic = "force-dynamic";

/**
 * Gap clustering (spec: gap-cluster-members-and-ignored-terms): the words
 * removed from a question before it is embedded to find its cluster. A name
 * repeated in nearly every question makes unrelated questions look alike, and
 * the measurement that motivated this setting had two of them merged.
 */
export default async function GapSettingsPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";
  const [org] = await getDb()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, project.orgId))
    .limit(1);

  return (
    <>
      <PageHeader
        title="Gaps"
        description={
          <>
            Questions on the Gaps page are grouped by meaning. Your own name, repeated in nearly
            every question, makes unrelated questions look alike — so it is removed before a
            question is compared with the others. It is never removed from what you read.
          </>
        }
      />
      <GapSettingsForm gaps={project.gaps} orgName={org?.name ?? ""} canEdit={canEdit} />
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <div className="max-w-md">
            <h2 className="text-sm font-medium">Regroup existing questions</h2>
            <p className="text-sm text-muted-foreground">
              Settings apply to questions asked from now on. Rebuilding groups the ones you already
              have the same way — and drops the clusters you marked resolved.
            </p>
          </div>
          <ReclusterButton action={reclusterProject} />
        </div>
      ) : null}
    </>
  );
}
