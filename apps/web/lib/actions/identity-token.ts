import { type Database, signingKeys } from "@deskbell/db";
import { newId } from "@deskbell/shared";
import { isNull } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

/**
 * The visitor identity token an MCP server receives (spec: mcp-actions,
 * Identity). Deskbell verified the visitor against the project's identity
 * provider on this request (D16); what a server needs is a statement of
 * that, signed by this instance, scoped to the server and short-lived — not
 * the provider's own token, whose audience was never the server.
 *
 * Keys are generated on first use and stored; the public halves are served
 * by the JWKS route. One process caches the active key for its lifetime.
 */

export const IDENTITY_TOKEN_ALG = "ES256";
export const IDENTITY_TOKEN_TTL_S = 5 * 60;
/** A retired key stays published this long so in-flight tokens still verify. */
export const RETIRED_KEY_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SigningKey {
  kid: string;
  publicJwk: JWK;
  privateKey: CryptoKey;
}

const globalForKeys = globalThis as unknown as { deskbellSigningKey?: Promise<SigningKey> };

async function loadOrCreateKey(db: Database): Promise<SigningKey> {
  const [active] = await db
    .select()
    .from(signingKeys)
    .where(isNull(signingKeys.retiredAt))
    .orderBy(signingKeys.createdAt)
    .limit(1);
  if (active) {
    return {
      kid: active.kid,
      publicJwk: active.publicJwk as JWK,
      privateKey: (await importJWK(active.privateJwk as JWK, IDENTITY_TOKEN_ALG)) as CryptoKey,
    };
  }
  const { publicKey, privateKey } = await generateKeyPair(IDENTITY_TOKEN_ALG, {
    extractable: true,
  });
  const kid = newId("key");
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: IDENTITY_TOKEN_ALG,
    use: "sig",
  };
  const privateJwk: JWK = { ...(await exportJWK(privateKey)), kid, alg: IDENTITY_TOKEN_ALG };
  await db.insert(signingKeys).values({
    kid,
    alg: IDENTITY_TOKEN_ALG,
    publicJwk: publicJwk as Record<string, unknown>,
    privateJwk: privateJwk as Record<string, unknown>,
  });
  // Two instances booting at once may both insert; the oldest active key is
  // the one everyone signs with from now on, so read back rather than trust
  // what this process generated.
  const [oldest] = await db
    .select()
    .from(signingKeys)
    .where(isNull(signingKeys.retiredAt))
    .orderBy(signingKeys.createdAt)
    .limit(1);
  if (oldest && oldest.kid !== kid) {
    return {
      kid: oldest.kid,
      publicJwk: oldest.publicJwk as JWK,
      privateKey: (await importJWK(oldest.privateJwk as JWK, IDENTITY_TOKEN_ALG)) as CryptoKey,
    };
  }
  return { kid, publicJwk, privateKey: privateKey as CryptoKey };
}

export function getSigningKey(db: Database): Promise<SigningKey> {
  globalForKeys.deskbellSigningKey ??= loadOrCreateKey(db).catch((error) => {
    globalForKeys.deskbellSigningKey = undefined;
    throw error;
  });
  return globalForKeys.deskbellSigningKey;
}

/** Test seam: forget the cached key so the next call reads the table again. */
export function resetSigningKey(): void {
  globalForKeys.deskbellSigningKey = undefined;
}

export interface IdentityTokenInput {
  /** This instance's public URL: the `iss` claim, and where `/api/v1/actions/jwks` lives. */
  issuer: string;
  /** The server's slug: the `aud` claim. */
  audience: string;
  visitor: { subject: string; issuer: string; email: string | null; name: string | null };
  projectId: string;
  conversationId: string;
}

/**
 * Claims: `sub` is the visitor's subject at their own identity provider and
 * `deskbell_issuer` names that provider, so a server that also trusts the
 * provider directly can correlate the two. Nothing from the provider's token
 * beyond email and name is forwarded.
 */
export async function mintIdentityToken(
  key: SigningKey,
  input: IdentityTokenInput,
): Promise<string> {
  return new SignJWT({
    deskbell_issuer: input.visitor.issuer,
    ...(input.visitor.email ? { email: input.visitor.email } : {}),
    ...(input.visitor.name ? { name: input.visitor.name } : {}),
    project: input.projectId,
    conversation: input.conversationId,
  })
    .setProtectedHeader({ alg: IDENTITY_TOKEN_ALG, kid: key.kid, typ: "JWT" })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.visitor.subject)
    .setIssuedAt()
    .setExpirationTime(`${IDENTITY_TOKEN_TTL_S}s`)
    .setJti(newId("jti"))
    .sign(key.privateKey);
}

/** The public key set: every active key and every key retired within the grace period. */
export async function publicKeySet(db: Database, now = new Date()): Promise<{ keys: JWK[] }> {
  const rows = await db.select().from(signingKeys).orderBy(signingKeys.createdAt);
  const cutoff = now.getTime() - RETIRED_KEY_GRACE_MS;
  return {
    keys: rows
      .filter((row) => !row.retiredAt || row.retiredAt.getTime() > cutoff)
      .map((row) => row.publicJwk as JWK),
  };
}
