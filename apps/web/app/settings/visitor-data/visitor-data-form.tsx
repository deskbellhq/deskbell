"use client";

import { OWN_DATA_REPLY_MAX_LENGTH, type ProjectAnswering } from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Textarea } from "@deskbell/ui/components/textarea";
import { useActionState } from "react";

import { saveAnswerSettings } from "./actions";

/**
 * The own-data reply form (spec: own-data-fallback). One field: what the
 * visitor reads when they ask about their own account and nothing on the
 * turn can look. Empty means the rule is off and such a question is answered
 * or refused like any other.
 */
export function VisitorDataForm({
  answering,
  canEdit,
}: {
  answering: ProjectAnswering;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveAnswerSettings, undefined);

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="ownDataReply">
              Reply for questions about the visitor's own data
            </FieldLabel>
            <FieldDescription>
              Shown word for word, in the assistant's voice, when a visitor asks what is true in
              their own account and no connected action can look it up. Say what the assistant
              cannot see and what the visitor can share instead. Leave it empty to switch the rule
              off.
            </FieldDescription>
          </FieldContent>
          <Textarea
            id="ownDataReply"
            name="ownDataReply"
            defaultValue={answering.ownDataReply ?? ""}
            rows={5}
            maxLength={OWN_DATA_REPLY_MAX_LENGTH}
            disabled={!canEdit}
            placeholder="I can't see your account or its settings from here. If you share the setting, the value and what you see, I can help you work through it."
          />
        </Field>
      </FieldGroup>
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved. Questions asked from now on get this reply.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only admins can change visitor data settings.
        </p>
      )}
    </form>
  );
}
