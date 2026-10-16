"use client";

import { Button } from "@deskbell/ui/components/button";
import { Card, CardContent } from "@deskbell/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { cn } from "@deskbell/ui/lib/utils";
import Link from "next/link";
import { useActionState } from "react";

import { requestReset } from "@/app/forgot-password/actions";

const SIGN_IN_LINK = (
  <FieldDescription className="text-center">
    Remembered it?{" "}
    <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
      Sign in
    </Link>
  </FieldDescription>
);

export function ForgotPasswordForm({
  emailDisabled,
  className,
  ...props
}: { emailDisabled: boolean } & React.ComponentProps<"div">) {
  const [state, formAction, pending] = useActionState(requestReset, {});

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          {emailDisabled ? (
            <FieldGroup>
              <p className="text-sm text-muted-foreground">
                This instance cannot send email, so self-serve password reset is off. Ask whoever
                operates it to configure <code>SMTP_URL</code> — or, if that is you, use the
                recovery procedure in the self-hosting docs.
              </p>
              {SIGN_IN_LINK}
            </FieldGroup>
          ) : state?.sent ? (
            <FieldGroup>
              <p className="text-sm text-muted-foreground">
                If an account exists for that address, a reset link is on its way. It is valid for
                one hour — check spam before requesting another.
              </p>
              {SIGN_IN_LINK}
            </FieldGroup>
          ) : (
            <form action={formAction}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Sending…" : "Send reset link"}
                  </Button>
                  {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
                  {SIGN_IN_LINK}
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
