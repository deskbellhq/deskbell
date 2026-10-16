/**
 * Every knob for spec: widget-abuse-protection, read once per process.
 *
 * Request rates live in env rather than the database on purpose: they protect
 * the deployment, so an operator must be able to cap a runaway tenant from
 * outside the app. Spend is the opposite — it belongs to the project, and lives
 * in `projects.daily_token_budget` (see ./budget.ts).
 *
 * Defaults are deliberately ON. A public endpoint that spends LLM tokens is a
 * cost-abuse magnet, so an operator who never reads the security guide is still
 * protected; raising a limit is a conscious act.
 */

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true" || value.trim() === "1";
}

export interface AbuseConfig {
  /** Empty allowlist answers any origin. Off in production unless set (see ../widget-cors.ts). */
  allowAnyOrigin: boolean;
  /** Master off switch — load testing, or a deployment reachable only from a trusted network. */
  disabled: boolean;
  askPerMinute: number;
  askPerHour: number;
  projectPerMinute: number;
  readPerMinute: number;
  maxConcurrentAsks: number;
  /** x-forwarded-for hops to skip from the right (see ./client.ts). */
  trustedProxies: number;
  /** HMAC key for IP hashing; falls back to the auth secret so it is never empty in practice. */
  ipSalt: string;
  isProduction: boolean;
}

export function readAbuseConfig(env: NodeJS.ProcessEnv = process.env): AbuseConfig {
  return Object.freeze({
    allowAnyOrigin: bool(env.DESKBELL_ALLOW_ANY_ORIGIN),
    disabled: bool(env.DESKBELL_ABUSE_PROTECTION_DISABLED),
    askPerMinute: int(env.DESKBELL_RATE_LIMIT_ASK_PER_MIN, 10),
    askPerHour: int(env.DESKBELL_RATE_LIMIT_ASK_PER_HOUR, 100),
    projectPerMinute: int(env.DESKBELL_RATE_LIMIT_PROJECT_PER_MIN, 120),
    readPerMinute: int(env.DESKBELL_RATE_LIMIT_READ_PER_MIN, 60),
    maxConcurrentAsks: int(env.DESKBELL_MAX_CONCURRENT_ASKS, 2),
    trustedProxies: int(env.DESKBELL_TRUSTED_PROXIES, 0),
    ipSalt: env.DESKBELL_IP_SALT || env.BETTER_AUTH_SECRET || "deskbell-dev-salt",
    isProduction: env.NODE_ENV === "production",
  });
}

let cached: AbuseConfig | undefined;

/** Process-wide config. Tests call readAbuseConfig() with their own env instead. */
export function abuseConfig(): AbuseConfig {
  cached ??= readAbuseConfig();
  return cached;
}
