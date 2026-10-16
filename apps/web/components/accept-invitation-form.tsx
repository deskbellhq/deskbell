"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deskbell/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Accept flow for all three arrival states (spec: dashboard-auth):
 * no session → create the invited account (email locked) or sign in with it;
 * session under the invited email → one-click accept;
 * session under another email → prompt to sign out first (the plugin rejects
 * a mismatched acceptance server-side regardless).
 */
export function AcceptInvitationForm({
  invitationId,
  email,
  role,
  orgName,
  inviterName,
  sessionEmail,
}: {
  invitationId: string;
  email: string;
  role: string;
  orgName: string;
  inviterName: string;
  sessionEmail: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const matched = sessionEmail !== null && sessionEmail.toLowerCase() === email.toLowerCase();
  const mismatched = sessionEmail !== null && !matched;

  async function accept() {
    const { error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (acceptError) throw new Error(acceptError.message ?? "Could not accept the invitation.");
    router.push("/");
    router.refresh();
  }

  async function submit(formData: FormData) {
    setPending(true);
    setError(undefined);
    try {
      if (!matched) {
        const password = String(formData.get("password") ?? "");
        if (mode === "sign-up") {
          const name = String(formData.get("name") ?? "").trim();
          const { error: signUpError } = await authClient.signUp.email({ name, email, password });
          if (signUpError) throw new Error(signUpError.message ?? "Could not create the account.");
        } else {
          const { error: signInError } = await authClient.signIn.email({ email, password });
          if (signInError) throw new Error(signInError.message ?? "Could not sign in.");
        }
      }
      await accept();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPending(false);
    }
  }

  if (mismatched) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation for someone else</CardTitle>
          <CardDescription>
            This invitation is for {email}, but you are signed in as {sessionEmail}. Sign out first,
            then open the link again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              authClient.signOut({ fetchOptions: { onSuccess: () => router.refresh() } })
            }
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {orgName}</CardTitle>
        <CardDescription>
          {inviterName} invited {email} as {role}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {matched ? (
          <div className="flex flex-col gap-3">
            <Button className="w-full" disabled={pending} onClick={() => submit(new FormData())}>
              {pending ? "Accepting…" : "Accept invitation"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <form action={submit}>
            <FieldGroup>
              {mode === "sign-up" && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" name="name" placeholder="Ada Lovelace" required />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input id="invite-email" type="email" value={email} disabled />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={mode === "sign-up" ? 8 : undefined}
                  required
                />
              </Field>
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending
                    ? "Working…"
                    : mode === "sign-up"
                      ? "Create account & join"
                      : "Sign in & join"}
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <FieldDescription className="text-center">
                  {mode === "sign-up" ? (
                    <>
                      Already have an account on this instance?{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setMode("sign-in")}
                      >
                        Sign in instead
                      </button>
                    </>
                  ) : (
                    <>
                      New here?{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setMode("sign-up")}
                      >
                        Create the account
                      </button>
                    </>
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
