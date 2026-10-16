import { invitations, organizations, users } from "@deskbell/db";
import { eq } from "drizzle-orm";

import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { BellMark } from "@/components/bell-mark";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Invitation landing page (spec: dashboard-auth). Read through drizzle rather
 * than the plugin's get-invitation endpoint because that endpoint requires a
 * session, and the whole point of this page is to greet someone who does not
 * have one yet. Rendering org name + invited email for a possessed invitation
 * id leaks nothing the inviter did not put in the link on purpose.
 */
export default async function Page({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const db = getDb();
  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      orgName: organizations.name,
      inviterName: users.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
    .innerJoin(users, eq(invitations.inviterId, users.id))
    .where(eq(invitations.id, invitationId))
    .limit(1);

  const expired = row?.expiresAt != null ? row.expiresAt.getTime() <= Date.now() : false;
  const usable = row !== undefined && row.status === "pending" && !expired;
  const session = await getSession();

  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6 md:p-10">
      <span className="flex items-center gap-2 font-semibold">
        <BellMark size={22} className="shrink-0 text-[#2b6b4f]" />
        Deskbell
      </span>
      <div className="w-full max-w-sm">
        {usable ? (
          <AcceptInvitationForm
            invitationId={row.id}
            email={row.email}
            role={row.role}
            orgName={row.orgName}
            inviterName={row.inviterName}
            sessionEmail={session?.user.email ?? null}
          />
        ) : (
          <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            {row === undefined
              ? "This invitation link is not valid."
              : row.status !== "pending"
                ? "This invitation has already been used or was revoked."
                : "This invitation has expired. Ask your admin to send a new one."}
          </div>
        )}
      </div>
    </div>
  );
}
