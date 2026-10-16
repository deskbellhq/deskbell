"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth/form-state";
import { requireMember } from "@/lib/auth/session";

/**
 * Own-profile mutation (spec: dashboard-ia-settings). Any role may rename
 * itself — this touches nothing beyond the user's own row, and the write goes
 * through getAuth().api so better-auth owns validation and session refresh.
 */
export async function updateDisplayName(
  _prev: { error?: string; savedAt?: number } | undefined,
  formData: FormData,
): Promise<{ error?: string; savedAt?: number }> {
  await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a name." };
  try {
    await getAuth().api.updateUser({ body: { name }, headers: await headers() });
  } catch (error) {
    return { error: authErrorMessage(error, "Could not update the name.") };
  }
  revalidatePath("/settings/account");
  return { savedAt: Date.now() };
}
