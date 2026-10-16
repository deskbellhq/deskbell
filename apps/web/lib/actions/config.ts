/**
 * Request-side knobs for actions (spec: mcp-actions). The model-side ones
 * (steps, per-call timeout, result size) live in `@deskbell/core/models`.
 *
 *   DESKBELL_ACTION_APPROVAL_TTL_MIN  how long a confirmation card can be answered (default 10)
 */
export interface ActionRequestConfig {
  approvalTtlMs: number;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[actions] ignoring ${name}="${raw}" — using ${fallback}`);
  return fallback;
}

export function readActionConfig(env: NodeJS.ProcessEnv = process.env): ActionRequestConfig {
  return Object.freeze({
    approvalTtlMs: positiveInt(env, "DESKBELL_ACTION_APPROVAL_TTL_MIN", 10) * 60_000,
  });
}

let cached: ActionRequestConfig | undefined;
export function actionConfig(): ActionRequestConfig {
  cached ??= readActionConfig();
  return cached;
}

/** The issuer of visitor identity tokens: the instance's public URL, else where the request arrived. */
export function identityIssuer(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const candidate of [env.DESKBELL_PUBLIC_URL, env.BETTER_AUTH_URL]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // Misconfigured; try the next.
    }
  }
  return requestOrigin ?? "http://localhost:3000";
}
