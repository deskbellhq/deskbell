import { type Database, endUsers } from "@deskbell/db";
import { newId } from "@deskbell/shared";
import { sql } from "drizzle-orm";
import type { VerifiedIdentity } from "./verify";

/** What the guard hands routes: enough to own rows and to show a name. */
export interface EndUser {
  id: string;
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
  claims: VerifiedIdentity["claims"];
}

/**
 * The visitor's row, created on first sight and refreshed on every request
 * (spec: end-user-identity). One upsert on (project, issuer, subject); the
 * profile fields follow the token so a renamed account shows its new name
 * without a migration of anything. A token that carries no name or email
 * says nothing about either, so the stored value stays: an access token
 * minted for actions must not blank what the sign-in token wrote.
 */
export async function touchEndUser(
  db: Database,
  scope: { orgId: string; projectId: string },
  identity: VerifiedIdentity,
): Promise<EndUser> {
  const now = new Date();
  const [row] = await db
    .insert(endUsers)
    .values({
      id: newId("eu"),
      orgId: scope.orgId,
      projectId: scope.projectId,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [endUsers.projectId, endUsers.issuer, endUsers.subject],
      set: {
        email: sql`coalesce(excluded.email, ${endUsers.email})`,
        name: sql`coalesce(excluded.name, ${endUsers.name})`,
        lastSeenAt: now,
      },
    })
    .returning({ id: endUsers.id, email: endUsers.email, name: endUsers.name });
  if (!row) throw new Error("end user upsert returned no row");
  return {
    id: row.id,
    issuer: identity.issuer,
    subject: identity.subject,
    email: row.email,
    name: row.name,
    claims: identity.claims,
  };
}
