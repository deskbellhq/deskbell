import type { ProjectIdentity } from "@deskbell/shared";
import type { VerifiedIdentity } from "./verify";

/**
 * The identity branch of the widget guard, as a pure decision (spec:
 * end-user-identity). Kept free of jose and the database so every outcome is
 * a unit test: not configured, anonymous allowed, anonymous refused, bad
 * token, good token.
 */

export type IdentityOutcome =
  | { kind: "anonymous" }
  | { kind: "verified"; identity: VerifiedIdentity }
  | { kind: "unauthorized"; reason: "missing" | "invalid" };

/** `Authorization: Bearer <token>`; anything else is no token. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

/** A project verifies identity when it names an issuer. */
export function identityConfigured(
  identity: Partial<ProjectIdentity> | null | undefined,
): identity is ProjectIdentity {
  return typeof identity?.issuer === "string" && identity.issuer.length > 0;
}

export async function resolveIdentity(opts: {
  authorization: string | null;
  identity: Partial<ProjectIdentity> | null | undefined;
  verify: (token: string, identity: ProjectIdentity) => Promise<VerifiedIdentity>;
}): Promise<IdentityOutcome> {
  if (!identityConfigured(opts.identity)) return { kind: "anonymous" };
  const token = bearerToken(opts.authorization);
  if (!token) {
    return opts.identity.required
      ? { kind: "unauthorized", reason: "missing" }
      : { kind: "anonymous" };
  }
  try {
    return { kind: "verified", identity: await opts.verify(token, opts.identity) };
  } catch {
    // Fail closed: a token that was sent and does not verify is refused even
    // when anonymous access is allowed. Silently downgrading a bad token to
    // "anonymous" would hide a broken integration behind a working widget.
    return { kind: "unauthorized", reason: "invalid" };
  }
}
