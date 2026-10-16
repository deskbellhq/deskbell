"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { type AuthFormState, authErrorMessage } from "@/lib/auth/form-state";

/**
 * Sign-up (spec: register-login-pages). The form renders unconditionally;
 * closedSignupGate decides server-side whether this instance admits the
 * account (first user, invited email) or answers with the invitation-only
 * message that surfaces here as the form error.
 */
export async function signUp(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name) return { error: "Enter a name." };
  try {
    await getAuth().api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    });
  } catch (error) {
    return { error: authErrorMessage(error, "Could not create the account.") };
  }
  redirect("/");
}
