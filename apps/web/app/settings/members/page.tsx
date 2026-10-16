import { invitations, members, organizations, users } from "@deskbell/db";
import { Badge } from "@deskbell/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@deskbell/ui/components/table";
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { CopyButton } from "@/components/copy-button";
import { InviteMemberForm } from "@/components/invite-member-form";
import { MemberRowActions } from "@/components/member-row-actions";
import { PageHeader } from "@/components/page-header";
import { SignInDomainsForm } from "@/components/sign-in-domains-form";
import { authConfig } from "@/lib/auth/config";
import { requireMember } from "@/lib/auth/session";
import { getPublicBaseUrl } from "@/lib/base-url";
import { getDb } from "@/lib/db";
import { emailConfig } from "@/lib/email/config";

import { revokeInvitation } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Members & invitations (spec: dashboard-auth). Reads go straight through
 * drizzle (org-scoped); writes go through ./actions → auth.api so the org
 * plugin's permission checks apply. Pending invitations surface a copyable
 * accept URL — with outbound email configured the invitee also gets it by
 * mail (spec: invitation-email); the copyable link is the always-works path.
 */
export default async function MembersPage() {
  // Page-level denial redirects rather than throwing: a viewer typing the URL
  // should land on their account page, not an error page. Mutations still
  // hard-gate in ./actions (checkRole), so this is presentation, not the fence.
  const { session, memberId, role } = await requireMember();
  if (role !== "admin" && role !== "owner") redirect("/settings/account");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("Session has no active organization — sign out and back in.");
  const db = getDb();
  const [memberRows, pendingInvitations, baseUrl, org] = await Promise.all([
    db
      .select({
        id: members.id,
        role: members.role,
        createdAt: members.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(eq(members.organizationId, orgId))
      .orderBy(asc(members.createdAt)),
    db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(and(eq(invitations.organizationId, orgId), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt)),
    getPublicBaseUrl(),
    // A plain select rather than db.query: the relational builder reads the
    // table shape cached when the connection was made, so a dev server that
    // predates a migration selects nothing and throws. select() uses the
    // imported table object and is immune.
    db
      .select({ allowedSignInDomains: organizations.allowedSignInDomains })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  const googleConfigured = authConfig().google !== null;

  return (
    <>
      <PageHeader
        title="Members"
        description="Viewers read everything and change nothing; editors manage sources and appearance;
          admins also manage install settings (origins, token budget) and members."
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Invite a member</h2>
          <p className="text-sm text-muted-foreground">
            {emailConfig().mode === "smtp"
              ? "Invitations are emailed to the invitee; every pending invitation also keeps a copyable link."
              : "Invitations create a link you hand to the invitee — this instance sends no email."}
          </p>
        </div>
        <InviteMemberForm />
      </section>

      {googleConfigured && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Sign-in domains</h2>
            <p className="text-sm text-muted-foreground">
              People with a Google account at these domains join as viewers the first time they sign
              in, without an invitation. Everyone else still needs one. One domain per line.
            </p>
          </div>
          <SignInDomainsForm domains={org?.allowedSignInDomains ?? []} />
        </section>
      )}

      {pendingInvitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-medium">Pending invitations</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Invite link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.expiresAt ? inv.expiresAt.toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <CopyButton
                          text={`${baseUrl}/accept-invitation/${inv.id}`}
                          label="Copy link"
                        />
                        <form action={revokeInvitation.bind(null, inv.id)}>
                          <button
                            type="submit"
                            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Revoke
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Members</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberRows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant={m.role === "owner" ? "default" : "outline"}>{m.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.createdAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <MemberRowActions memberId={m.id} role={m.role} isSelf={m.id === memberId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
