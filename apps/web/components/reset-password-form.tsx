"use client";

import { Button } from "@deskbell/ui/components/button";
import { Card, CardContent } from "@deskbell/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { cn } from "@deskbell/ui/lib/utils";
import Link from "next/link";
import { useActionState } from "react";

import { resetPassword } from "@/app/reset-password/actions";
import { PasswordInput } from "@/components/password-input";

export function ResetPasswordForm({
  token,
  className,
  ...props
}: { token: string | null } & React.ComponentProps<"div">) {
  const [state, formAction, pending] = useActionState(resetPassword, {});

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          {token === null ? (
            <FieldGroup>
              <p className="text-sm text-muted-foreground">
                This reset link is missing its token — it may have been cut short in the email.
              </p>
              <FieldDescription className="text-center">
                <Link
                  href="/forgot-password"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Request a new link
                </Link>
              </FieldDescription>
            </FieldGroup>
          ) : (
            <form action={formAction}>
              <input type="hidden" name="token" value={token} />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">New password</FieldLabel>
                  <PasswordInput id="password" name="password" minLength={8} required />
                </Field>
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Resetting…" : "Reset password"}
                  </Button>
                  {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
                  <FieldDescription className="text-center">
                    Link expired?{" "}
                    <Link
                      href="/forgot-password"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Request a new one
                    </Link>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
