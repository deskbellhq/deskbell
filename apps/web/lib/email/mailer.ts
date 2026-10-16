import { createTransport } from "nodemailer";

import { type EmailConfig, emailConfig } from "./config";

/**
 * Minimal outbound mail (spec: password-reset-email). Plain text only — the
 * mails this instance sends are single-link notifications, and text survives
 * every client and spam filter that HTML has to fight.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/** What sendEmail needs from a nodemailer transporter — injectable in tests. */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** Production with no SMTP configured. Callers decide how loud to be. */
export class EmailDisabledError extends Error {
  constructor() {
    super("Outbound email is not configured (SMTP_URL / EMAIL_FROM). This mail was not sent.");
    this.name = "EmailDisabledError";
  }
}

// Survives dev HMR reloads — same pattern as lib/db.ts getDb().
const globalForMailer = globalThis as unknown as { deskbellMailer?: MailTransport };

function smtpTransport(config: EmailConfig): MailTransport {
  globalForMailer.deskbellMailer ??= createTransport(config.smtpUrl ?? undefined);
  return globalForMailer.deskbellMailer;
}

export async function sendEmail(
  mail: OutboundEmail,
  config: EmailConfig = emailConfig(),
  transport?: MailTransport,
): Promise<void> {
  switch (config.mode) {
    case "smtp": {
      // config.from is non-null whenever mode is "smtp" (see readEmailConfig).
      const from = config.from as string;
      await (transport ?? smtpTransport(config)).sendMail({ from, ...mail });
      return;
    }
    case "console":
      console.log(
        [
          "── email (console delivery — no SMTP_URL configured) ──",
          `To: ${mail.to}`,
          `Subject: ${mail.subject}`,
          "",
          mail.text,
          "───────────────────────────────────────────────────────",
        ].join("\n"),
      );
      return;
    case "disabled":
      throw new EmailDisabledError();
  }
}
