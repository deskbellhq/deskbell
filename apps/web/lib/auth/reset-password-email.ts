import { sendEmail } from "@/lib/email/mailer";

/**
 * The password-reset mail (spec: password-reset-email). One hour matches
 * better-auth's default token expiry — change them together.
 */
export async function sendPasswordResetEmail(
  user: { email: string; name: string | null },
  url: string,
): Promise<void> {
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  await sendEmail({
    to: user.email,
    subject: "Reset your Deskbell password",
    text: [
      greeting,
      "Someone asked to reset the password for this email address on a Deskbell dashboard. Open this link to choose a new password:",
      url,
      "The link is valid for one hour and can be used once.",
      "If you did not request this, ignore this email — the password stays unchanged.",
    ].join("\n\n"),
  });
}
