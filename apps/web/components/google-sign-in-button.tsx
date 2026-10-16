"use client";

import { Button } from "@deskbell/ui/components/button";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * "Continue with Google" (spec: sign-in-with-google). Client-side on
 * purpose: the flow is a redirect to Google and back to /api/auth, so there
 * is no cookie for a server action to set. A rejection by the OAuth gate
 * lands on /login?error=… and the page explains it.
 */
export function GoogleSignInButton({ label = "Continue with Google" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authClient.signIn.social({
            provider: "google",
            callbackURL: "/",
            errorCallbackURL: "/login",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
        <path
          fill="currentColor"
          d="M21.35 11.1H12v2.9h5.4c-.25 1.4-1.6 4.1-5.4 4.1-3.25 0-5.9-2.7-5.9-6s2.65-6 5.9-6c1.85 0 3.1.8 3.8 1.45l2.6-2.5C16.75 3.5 14.6 2.5 12 2.5 6.75 2.5 2.5 6.75 2.5 12S6.75 21.5 12 21.5c5.5 0 9.15-3.85 9.15-9.3 0-.6-.05-1.05-.15-1.5z"
        />
      </svg>
      {pending ? "Redirecting…" : label}
    </Button>
  );
}
