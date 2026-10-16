import { users } from "@deskbell/db";
import { eq } from "drizzle-orm";

import { AccountForm, SignOutButton } from "@/components/account-form";
import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Account — the signed-in user's own profile (spec: dashboard-ia-settings).
 * Deliberately small: name is editable, email is not (an email change needs
 * its own verified flow), passwords move through the reset flow.
 */
export default async function AccountPage() {
  const { session } = await requireMember();
  // The session's cookie cache may lag a rename by minutes; the page that
  // edits the name must show the stored truth, so read the user row itself.
  const [user] = await getDb()
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id));

  return (
    <>
      <PageHeader
        title="Account"
        description="How you appear to other members of this workspace."
      />
      <AccountForm
        name={user?.name ?? session.user.name}
        email={user?.email ?? session.user.email}
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Session</h2>
          <p className="text-sm text-muted-foreground">
            Signs you out of this browser only — other sessions stay signed in.
          </p>
        </div>
        <SignOutButton />
      </section>
    </>
  );
}
