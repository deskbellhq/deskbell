import { sendEmail } from "@/lib/email/mailer";

/**
 * The invitation mail (spec: invitation-email). Delivery is a convenience
 * layer: the Members page always surfaces the same accept URL as a copyable
 * link, which is the contract on instances without outbound email.
 */
export async function sendInvitationEmail(invite: {
  email: string;
  url: string;
  role: string;
  organizationName: string;
  inviterName: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  const inviter = invite.inviterName || "An administrator";
  const expiry = invite.expiresAt
    ? `This invitation expires on ${invite.expiresAt.toUTCString()} and can be used once.`
    : "This invitation can be used once.";
  await sendEmail({
    to: invite.email,
    subject: `${inviter} invited you to ${invite.organizationName} on Deskbell`,
    text: [
      "Hi,",
      `${inviter} invited you to join ${invite.organizationName} on a Deskbell dashboard as ${invite.role}. Open this link to accept and create your account:`,
      invite.url,
      expiry,
      "If you were not expecting this, you can ignore this email.",
    ].join("\n\n"),
  });
}
