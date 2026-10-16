"use client";

import { Button } from "@deskbell/ui/components/button";
import { Card, CardContent } from "@deskbell/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { cn } from "@deskbell/ui/lib/utils";
import Link from "next/link";
import { useActionState } from "react";

import { signIn } from "@/app/login/actions";
import { AuthDivider } from "@/components/auth-divider";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordInput } from "@/components/password-input";

export function LoginForm({
  reset = false,
  notice = null,
  google = false,
  className,
  ...props
}: { reset?: boolean; notice?: string | null; google?: boolean } & React.ComponentProps<"div">) {
  const [state, formAction, pending] = useActionState(signIn, {});

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          {reset && (
            <p className="mb-6 text-center text-sm text-muted-foreground">
              Password updated — sign in with your new password.
            </p>
          )}
          {notice && (
            <p role="status" className="mb-6 text-center text-sm text-destructive">
              {notice}
            </p>
          )}
          {google && (
            <>
              <GoogleSignInButton />
              <AuthDivider />
            </>
          )}
          <form action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" placeholder="m@example.com" required />
              </Field>
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput id="password" name="password" required />
              </Field>
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
                {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
                <FieldDescription className="text-center">
                  No account yet?{" "}
                  <Link
                    href="/register"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Sign up
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
