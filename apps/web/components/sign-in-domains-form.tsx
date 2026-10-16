"use client";

import { Button } from "@deskbell/ui/components/button";
import { Label } from "@deskbell/ui/components/label";
import { Textarea } from "@deskbell/ui/components/textarea";
import { useActionState } from "react";

import { saveSignInDomains } from "@/app/settings/members/actions";

/**
 * Allowed sign-in domains (spec: sign-in-with-google): one per line. People
 * from these domains join as viewers when they first sign in with Google;
 * everyone else still needs an invitation.
 */
export function SignInDomainsForm({ domains }: { domains: string[] }) {
  const [state, formAction, pending] = useActionState(saveSignInDomains, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-domains">Allowed domains</Label>
        <Textarea
          id="sign-in-domains"
          name="domains"
          defaultValue={domains.join("\n")}
          placeholder={"example.com\nsubsidiary.example"}
          rows={3}
          spellCheck={false}
          className="max-w-md font-mono text-xs"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save domains"}
        </Button>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state?.saved && !state.error && <p className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
