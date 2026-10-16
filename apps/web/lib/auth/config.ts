/**
 * Auth environment, read once per process (spec: dashboard-auth). Same shape
 * discipline as ../abuse/config.ts: a pure reader tests can call with their
 * own env, plus a memoized process-wide accessor.
 */

/** Placeholder values that must never sign a production session. */
const PLACEHOLDER_SECRETS = new Set(["", "change-me"]);

export interface AuthConfig {
  secret: string;
  /** Externally visible origin — also the base of invitation links. */
  baseURL: string;
  /** True when the secret is empty or the .env.example placeholder. */
  secretIsPlaceholder: boolean;
  isProduction: boolean;
  /**
   * Google sign-in (spec: sign-in-with-google): on only when both variables
   * are set. Null otherwise — the provider is not registered and the pages
   * render no button.
   */
  google: { clientId: string; clientSecret: string } | null;
  /** Exactly one of the two Google variables is set — a misconfiguration, treated as off. */
  googleHalfConfigured: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  const googleId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  return Object.freeze({
    secret: secret || "deskbell-dev-insecure-secret",
    baseURL: env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
    secretIsPlaceholder: PLACEHOLDER_SECRETS.has(secret),
    isProduction: env.NODE_ENV === "production",
    google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null,
    googleHalfConfigured: Boolean(googleId) !== Boolean(googleSecret),
  });
}

let cached: AuthConfig | undefined;

/** Process-wide config. Tests call readAuthConfig() with their own env instead. */
export function authConfig(): AuthConfig {
  if (!cached) {
    cached = readAuthConfig();
    if (cached.secretIsPlaceholder && cached.isProduction) {
      // Compose refuses to start without the secret (${VAR:?} in docker-compose.yml);
      // this catches bare-metal deployments that bypassed compose. Loud, not fatal:
      // killing the process here would also kill the public widget endpoints.
      console.error(
        "BETTER_AUTH_SECRET is unset or a placeholder in production — dashboard sessions are forgeable. Set it before exposing this instance.",
      );
    }
    if (cached.googleHalfConfigured) {
      console.error(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together — Google sign-in stays off.",
      );
    }
  }
  return cached;
}
