"use client";

import type { ProjectGaps } from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Switch } from "@deskbell/ui/components/switch";
import { useActionState, useState } from "react";

import { saveGapSettings } from "./actions";

/**
 * The ignored-terms form (spec: gap-cluster-members-and-ignored-terms). The
 * switch is the storage: on saves no list at all, which resolves to the
 * organisation's name and follows a rename; off saves the list as typed, and
 * an empty one really does mean "remove nothing".
 */
export function GapSettingsForm({
  gaps,
  orgName,
  canEdit,
}: {
  gaps: ProjectGaps;
  orgName: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveGapSettings, undefined);
  const [useOrgName, setUseOrgName] = useState(gaps.ignoredTerms === undefined);

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="useOrgName">Ignore the workspace name</FieldLabel>
            <FieldDescription>
              Removes <strong>{orgName || "your workspace name"}</strong> from questions before they
              are compared, and keeps up with a rename.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="useOrgName"
            name="useOrgName"
            checked={useOrgName}
            onCheckedChange={setUseOrgName}
            disabled={!canEdit}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="terms">Terms to ignore</FieldLabel>
            <FieldDescription>
              One per line — a product name, a brand, anything that appears in questions without
              telling them apart. Matched whole-word, any case. An empty list removes nothing.
            </FieldDescription>
          </FieldContent>
          <textarea
            id="terms"
            name="terms"
            defaultValue={(gaps.ignoredTerms ?? []).join("\n")}
            rows={4}
            spellCheck={false}
            disabled={!canEdit || useOrgName}
            placeholder={orgName}
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </Field>
      </FieldGroup>
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved. Questions asked from now on are grouped this way; to regroup the ones you already
          have, rebuild them below.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change gap settings.</p>
      )}
    </form>
  );
}
