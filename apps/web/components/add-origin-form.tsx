"use client";

import { Button } from "@deskbell/ui/components/button";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { useActionState } from "react";

import { addAllowedOrigin } from "@/app/settings/install/actions";

/**
 * Allow one origin. Rendered by the Install page's allowlist and by the
 * getting-started page (spec: overview-getting-started), so the two never
 * validate or phrase the same field differently. The action canonicalizes
 * the value and reports an error in the useActionState shape.
 */
export function AddOriginForm() {
  const [state, formAction, pending] = useActionState(addAllowedOrigin, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="origin">Site origin</Label>
        <Input id="origin" name="origin" placeholder="https://www.example.com" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Allow origin"}
      </Button>
      {state?.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
