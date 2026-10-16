/**
 * The origin a notification's conversation link is built on (spec:
 * project-notifications). Environment only, never request headers: the
 * feedback endpoint is public, and a spoofed Host must not choose the link
 * a support agent clicks. DESKBELL_PUBLIC_URL wins; BETTER_AUTH_URL is the
 * externally visible origin every deployment already sets for invitation
 * links; the last resort matches the auth config's own default.
 */
export function notificationBaseUrl(env: Record<string, string | undefined> = process.env): string {
  for (const key of ["DESKBELL_PUBLIC_URL", "BETTER_AUTH_URL"] as const) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      return new URL(raw).origin;
    } catch {
      // Misconfigured: try the next one.
    }
  }
  return "http://localhost:3000";
}
