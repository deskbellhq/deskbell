import type { ProjectIdentity } from "@deskbell/shared";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

/**
 * Bearer-token verification for the widget endpoints (spec: end-user-identity).
 *
 * Fails closed: any problem — no key source, unreachable key set, wrong
 * issuer or audience, expired, bad signature — throws, and the guard turns a
 * throw into 401. Keys come from the project's inline `jwks` when present
 * (tests, air-gapped installs), otherwise from `jwksUrl`. Remote key sets are
 * cached per URL for the life of the process; jose refreshes them on an
 * unknown key id and rate-limits that refresh, so a rotated key is picked up
 * without a restart and a flood of bad tokens cannot hammer the issuer.
 */

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
  claims: JWTPayload;
}

const FETCH_TIMEOUT_MS = 5000;
const CLOCK_TOLERANCE_S = 30;

const remoteSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(identity: ProjectIdentity): JWTVerifyGetKey {
  if (identity.jwks)
    return createLocalJWKSet(identity.jwks as Parameters<typeof createLocalJWKSet>[0]);
  if (!identity.jwksUrl) throw new Error("identity has neither jwks nor jwksUrl");
  let set = remoteSets.get(identity.jwksUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL(identity.jwksUrl), {
      timeoutDuration: FETCH_TIMEOUT_MS,
      cooldownDuration: 30_000,
    });
    remoteSets.set(identity.jwksUrl, set);
  }
  return set;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export async function verifyEndUserToken(
  token: string,
  identity: ProjectIdentity,
): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, keySet(identity), {
    issuer: identity.issuer,
    ...(identity.audience ? { audience: identity.audience } : {}),
    clockTolerance: CLOCK_TOLERANCE_S,
  });
  const subject = str(payload.sub);
  if (!subject) throw new Error("token has no subject");
  return {
    issuer: identity.issuer,
    subject,
    email: str(payload.email),
    name: str(payload.name) ?? str(payload.preferred_username),
    claims: payload,
  };
}

/** Reads a claim by dot path; arrays are matched by membership. */
export function claimMatches(claims: JWTPayload, path: string, value: string): boolean {
  let node: unknown = claims;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  if (Array.isArray(node)) return node.includes(value);
  return node === value;
}

/** Test seam: forget cached remote key sets. */
export function resetKeySets(): void {
  remoteSets.clear();
}
