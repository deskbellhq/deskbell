import { users } from "@deskbell/db";
import { count } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { authConfig } from "@/lib/auth/config";
import { authErrorCopy } from "@/lib/auth/form-state";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Sign-in only (spec: register-login-pages): while the instance has no users
 * this redirects to /register, which doubles as first-run setup. The
 * zero-users check is presentation — closedSignupGate enforces the same rule
 * on the API whatever the pages render.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // A signed-in user with no membership is sent here with a reason; keep
  // them on the page so the sentence is read, instead of bouncing to /.
  const notice = authErrorCopy(
    one(params.error) ?? one(params.reason),
    one(params.error_description),
  );
  if (!notice && (await getSession())) redirect("/");
  const [row] = await getDb().select({ n: count() }).from(users);
  if ((row?.n ?? 0) === 0) redirect("/register");

  return (
    <AuthShell title="Sign in to your account">
      <LoginForm
        reset={one(params.reset) === "1"}
        notice={notice}
        google={authConfig().google !== null}
      />
    </AuthShell>
  );
}
