"use client";

import { Button } from "@deskbell/ui/components/button";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { useActionState } from "react";

import { addDocsSource } from "@/app/(dashboard)/sources/actions";

export function AddSourceForm() {
  const [state, formAction, pending] = useActionState(addDocsSource, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="source-url">Docs URL</Label>
        <Input
          id="source-url"
          name="url"
          type="url"
          placeholder="https://docs.example.com"
          required
        />
      </div>
      <div className="flex w-28 flex-col gap-1.5">
        <Label htmlFor="source-max-pages">Max pages</Label>
        <Input id="source-max-pages" name="maxPages" type="number" min={1} defaultValue={50} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add source"}
      </Button>
      {state?.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
