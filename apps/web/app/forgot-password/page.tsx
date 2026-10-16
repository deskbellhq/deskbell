import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getSession } from "@/lib/auth/session";
import { emailConfig } from "@/lib/email/config";

export const dynamic = "force-dynamic";

/**
 * Self-serve reset entry (spec: password-reset-email). Without outbound
 * email there is no secure self-serve path — showing the link to the
 * requester would be account takeover — so the disabled state says what to
 * do instead of pretending to send.
 */
export default async function Page() {
  if (await getSession()) redirect("/");
  const emailDisabled = emailConfig().mode === "disabled";

  return (
    <AuthShell title="Reset your password">
      <ForgotPasswordForm emailDisabled={emailDisabled} />
    </AuthShell>
  );
}
