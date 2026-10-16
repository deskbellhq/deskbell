/**
 * Outbound email environment, read once per process (spec:
 * password-reset-email). Same shape discipline as ../auth/config.ts: a pure
 * reader tests can call with their own env, plus a memoized accessor.
 *
 * SMTP is the interface on purpose: every hosted provider and every local
 * dev tool speaks it, so one URL covers them all without a provider SDK —
 * the same default-vs-interface split D13 applies to models and vector
 * stores. Email stays OPTIONAL: Postgres remains the only required
 * infrastructure, and everything email powers degrades honestly without it.
 */

export type EmailDeliveryMode = "smtp" | "console" | "disabled";

export interface EmailConfig {
  /** smtp:// or smtps:// URL, credentials included. */
  smtpUrl: string | null;
  /** Sender for outbound mail — must be one the SMTP provider accepts. */
  from: string | null;
  /**
   * smtp: deliver via smtpUrl. console: print to the server log instead
   * (development without SMTP). disabled: production without SMTP — flows
   * that need email must say so rather than pretend to send.
   */
  mode: EmailDeliveryMode;
}

export function readEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const smtpUrl = env.SMTP_URL?.trim() || null;
  const from = env.EMAIL_FROM?.trim() || null;
  const configured = smtpUrl !== null && from !== null;
  const mode: EmailDeliveryMode = configured
    ? "smtp"
    : env.NODE_ENV === "production"
      ? "disabled"
      : "console";
  return Object.freeze({ smtpUrl, from, mode });
}

let cached: EmailConfig | undefined;

/** Process-wide config. Tests call readEmailConfig() with their own env instead. */
export function emailConfig(): EmailConfig {
  if (!cached) {
    cached = readEmailConfig();
    if (cached.smtpUrl !== null && cached.from === null) {
      console.error(
        "SMTP_URL is set but EMAIL_FROM is not — outbound email stays off. Set EMAIL_FROM to a sender your SMTP provider accepts.",
      );
    }
  }
  return cached;
}
