import { APIError } from "better-auth/api";

/**
 * Shared bits of the auth server actions (spec: register-login-pages).
 * Lives outside the "use server" files because those may only export async
 * functions.
 */

export interface AuthFormState {
  error?: string;
}

export function authErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    // better-auth messages are user-appropriate ("Invalid email or password",
    // rate-limit hints, the invitation-only message from our gate).
    return error.message || fallback;
  }
  return fallback;
}

/**
 * The sentence for a code the sign-in page receives in its URL: from the
 * OAuth gate (spec: sign-in-with-google), from better-auth's own callback
 * errors, or from requireMember's no-membership redirect. Unknown codes get
 * a generic line rather than the raw code.
 */
export function authErrorCopy(code: string | undefined, description?: string): string | null {
  if (!code) return null;
  switch (code) {
    case "signup_closed":
      return "Sign-up is invitation-only. Ask an instance admin for an invite link, then sign in with Google again.";
    case "email_domain_not_allowed":
      return "That email domain is not allowed to sign in here.";
    case "email_not_verified":
      return "Your Google account's email address is not verified.";
    case "account_not_linked":
    case "account_already_linked_to_different_user":
      return "That Google account cannot be linked to your existing account. Sign in with your password instead.";
    case "no-membership":
      return "You are signed in, but not a member of this workspace yet. Open your invite link, or ask an admin for one.";
    default:
      return (
        description?.trim() || "Sign-in did not complete. Try again, or sign in with your password."
      );
  }
}
