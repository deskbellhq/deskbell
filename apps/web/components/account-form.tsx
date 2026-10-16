"use client";

import { Button } from "@deskbell/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { updateDisplayName } from "@/app/settings/account/actions";
import { authClient } from "@/lib/auth-client";

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [state, formAction, pending] = useActionState(updateDisplayName, {});

  return (
    <form action={formAction} className="max-w-md">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" name="name" defaultValue={name} required />
          <FieldDescription>Shown in the sidebar and to other members.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" value={email} disabled />
          <FieldDescription>Email changes are not supported yet.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state?.savedAt && !state.error && !pending && (
            <p className="text-sm text-muted-foreground">Saved.</p>
          )}
        </Field>
      </FieldGroup>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      className="w-fit"
      onClick={() =>
        authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
      }
    >
      <LogOut />
      Log out
    </Button>
  );
}
