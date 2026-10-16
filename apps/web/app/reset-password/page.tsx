import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const dynamic = "force-dynamic";

/**
 * Landing page of the emailed link (spec: password-reset-email). No
 * signed-in redirect on purpose: a signed-in user following a reset link
 * should be able to finish it, and success revokes every session anyway.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = typeof token === "string" && token.length > 0 ? token : null;

  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm token={value} />
    </AuthShell>
  );
}
