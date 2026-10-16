"use server";

import { projects } from "@deskbell/db";
import { type ProjectIdentity, ProjectIdentitySchema } from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";

/**
 * End-user identity settings (spec: end-user-identity). Stored on the
 * project as a validated document; an empty issuer clears it, which returns
 * the project to anonymous sessions. Admin-gated like the allowlist: whoever
 * may decide which sites the widget answers may decide who it recognises.
 */

export interface IdentityFormState {
  error?: string;
  saved?: boolean;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function saveIdentity(
  _prev: IdentityFormState | undefined,
  formData: FormData,
): Promise<IdentityFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  const issuer = field(formData, "issuer");
  let identity: Partial<ProjectIdentity> = {};
  if (issuer) {
    let jwks: unknown;
    const rawJwks = field(formData, "jwks");
    if (rawJwks) {
      try {
        jwks = JSON.parse(rawJwks);
      } catch {
        return { error: "The inline key set must be a JSON document with a keys array." };
      }
    }
    const staffPath = field(formData, "staffClaimPath");
    const staffValue = field(formData, "staffClaimValue");
    if ((staffPath && !staffValue) || (!staffPath && staffValue)) {
      return { error: "A staff claim needs both a claim path and a value." };
    }
    const parsed = ProjectIdentitySchema.safeParse({
      issuer,
      audience: field(formData, "audience") || undefined,
      jwksUrl: field(formData, "jwksUrl") || undefined,
      jwks,
      required: formData.get("required") === "on",
      staffClaim: staffPath ? { path: staffPath, value: staffValue } : undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        error: issue
          ? `${issue.path.join(".") || "identity"}: ${issue.message}`
          : "Invalid settings",
      };
    }
    if (!parsed.data.jwksUrl && !parsed.data.jwks) {
      return {
        error: "Give a JWKS URL or paste the key set. Discover fills the URL from the issuer.",
      };
    }
    identity = parsed.data;
  }

  const project = await getDefaultProject();
  await getDb()
    .update(projects)
    .set({ identity, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/identity");
  return { saved: true };
}

/**
 * Reads the issuer's OpenID configuration and returns its key-set URL, so
 * an operator pastes one address instead of two. Server-side: the browser
 * would be blocked by the issuer's CORS policy, and the issuer must be
 * reachable from here anyway for verification to work.
 */
export async function discoverJwksUrl(
  issuer: string,
): Promise<{ jwksUrl?: string; error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  let base: URL;
  try {
    base = new URL(issuer.trim());
  } catch {
    return { error: "Enter the issuer as a full URL, e.g. https://id.example.com/realms/app" };
  }
  if (base.protocol !== "https:" && base.hostname !== "localhost") {
    return { error: "The issuer must be served over https." };
  }
  const path = `${base.pathname.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  try {
    const res = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!res.ok)
      return { error: `The issuer answered ${res.status} for its OpenID configuration.` };
    const doc = (await res.json()) as { jwks_uri?: unknown };
    if (typeof doc.jwks_uri !== "string")
      return { error: "The OpenID configuration has no jwks_uri." };
    return { jwksUrl: doc.jwks_uri };
  } catch {
    return { error: "Could not reach the issuer's OpenID configuration from this server." };
  }
}
