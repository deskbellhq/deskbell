"use client";

import { ANSWER_STYLE_MAX_LENGTH } from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Textarea } from "@deskbell/ui/components/textarea";
import { useActionState, useState } from "react";

import { saveAnswerStyle } from "./actions";

const PLACEHOLDER =
  "Answer in two or three short sentences. Address the visitor as “you”. Use plain words and no exclamation marks.";

/**
 * The answer-style form (spec: answer-style). One textarea, saved as typed
 * (trimmed on the server); an empty one restores the instruction as shipped.
 * The counter under it is the only client state: the limit is enforced on
 * the server, this just says where the edge is before a save fails.
 */
export function AnswerStyleForm({
  answerStyle,
  canEdit,
}: {
  answerStyle: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveAnswerStyle, undefined);
  const [value, setValue] = useState(answerStyle);
  const over = value.trim().length > ANSWER_STYLE_MAX_LENGTH;

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="answerStyle">Style instruction</FieldLabel>
            <FieldDescription>
              Written to the model, in any language. Leave it empty to keep the default voice.
            </FieldDescription>
          </FieldContent>
          <Textarea
            id="answerStyle"
            name="answerStyle"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={5}
            disabled={!canEdit}
            placeholder={PLACEHOLDER}
            aria-invalid={over || undefined}
            className="min-h-28"
          />
          <p
            className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {value.trim().length.toLocaleString("en-US")} /{" "}
            {ANSWER_STYLE_MAX_LENGTH.toLocaleString("en-US")}
          </p>
        </Field>
      </FieldGroup>
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved.{" "}
          {state.cleared
            ? "The assistant answers in the default voice from the next question on."
            : "The next answer follows it; conversations already open pick it up on their next turn."}
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending || over}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change the answer style.</p>
      )}
    </form>
  );
}
