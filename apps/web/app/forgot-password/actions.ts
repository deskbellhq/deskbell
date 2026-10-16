"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth/form-state";

export interface ForgotPasswordState {
  sent?: boolean;
  error?: string;
}

/**
 * Requests a reset link (spec: password-reset-email). better-auth answers
 * identically whether or not the account exists, and rate-limits the route
 * (3/min per IP) — this action adds nothing that could tell the two apart.
 */
export async function requestReset(
  _prev: ForgotPasswordState | undefined,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };
  try {
    await getAuth().api.requestPasswordReset({
      body: { email },
      headers: await headers(),
    });
  } catch (error) {
    return { error: authErrorMessage(error, "Could not request a reset link.") };
  }
  return { sent: true };
}
