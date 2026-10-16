"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { type AuthFormState, authErrorMessage } from "@/lib/auth/form-state";

/**
 * Sign-in (spec: dashboard-auth). Server action rather than a client fetch so
 * the session cookie is set through nextCookies() and the redirect happens
 * server-side in the same round trip. Sign-up lives in ../register/actions.ts.
 */
export async function signIn(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  try {
    await getAuth().api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    return { error: authErrorMessage(error, "Invalid email or password.") };
  }
  redirect("/");
}
