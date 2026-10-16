"use client";

import { Button } from "@deskbell/ui/components/button";
import { Card, CardContent } from "@deskbell/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { cn } from "@deskbell/ui/lib/utils";
import Link from "next/link";
import { useActionState } from "react";

import { signUp } from "@/app/register/actions";
import { AuthDivider } from "@/components/auth-divider";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordInput } from "@/components/password-input";

/**
 * Renders regardless of signup policy (spec: register-login-pages) — the
 * closedSignupGate answers on submit; only the helper copy varies. On first
 * run the account created here owns the instance.
 */
export function RegisterForm({
  firstRun,
  google = false,
  className,
  ...props
}: { firstRun: boolean; google?: boolean } & React.ComponentProps<"div">) {
  const [state, formAction, pending] = useActionState(signUp, {});

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          {google && (
            <>
              <GoogleSignInButton label="Sign up with Google" />
              <AuthDivider />
            </>
          )}
          <form action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" placeholder="Ada Lovelace" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" placeholder="m@example.com" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <PasswordInput id="password" name="password" minLength={8} required />
              </Field>
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending ? "Signing up…" : "Sign up"}
                </Button>
                {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
                <FieldDescription className="text-center">
                  {firstRun
                    ? "This instance has no users yet — the first account becomes its owner."
                    : "Sign-up is invitation-only — open your invite link to join, or ask an instance admin for one."}
                </FieldDescription>
                <FieldDescription className="text-center">
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Sign in
                  </Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
