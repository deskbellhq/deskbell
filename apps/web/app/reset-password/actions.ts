"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth/form-state";

export interface ResetPasswordState {
  error?: string;
}

const INVALID_LINK = "This reset link is invalid or has expired — request a new one.";

/** Consumes the emailed token and sets the new password (spec: password-reset-email). */
export async function resetPassword(
  _prev: ResetPasswordState | undefined,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("password") ?? "");
  if (!token) return { error: INVALID_LINK };
  try {
    await getAuth().api.resetPassword({
      body: { newPassword, token },
      headers: await headers(),
    });
  } catch (error) {
    // better-auth's own wording for a dead token is a terse "Invalid token";
    // everything else (e.g. password length) passes through as-is.
    const message = authErrorMessage(error, INVALID_LINK);
    return { error: message === "Invalid token" ? INVALID_LINK : message };
  }
  redirect("/login?reset=1");
}
