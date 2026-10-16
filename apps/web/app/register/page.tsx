import { users } from "@deskbell/db";
import { count } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "@/components/register-form";
import { authConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Create-account page (spec: register-login-pages). Always renders the form;
 * closedSignupGate is the authority on whether the submission is admitted
 * (first user, invited email) or refused. firstRun only picks the helper
 * copy, because on a fresh instance the account created here owns it.
 */
export default async function Page() {
  if (await getSession()) redirect("/");
  const [row] = await getDb().select({ n: count() }).from(users);
  const firstRun = (row?.n ?? 0) === 0;

  return (
    <AuthShell title="Create new account">
      <RegisterForm firstRun={firstRun} google={authConfig().google !== null} />
    </AuthShell>
  );
}
