"use client";

import { Field, FieldContent, FieldDescription, FieldLabel } from "@deskbell/ui/components/field";
import { toast } from "@deskbell/ui/components/sonner";
import { Switch } from "@deskbell/ui/components/switch";
import { useState, useTransition } from "react";

import { saveClassifySwitch } from "./actions";

/**
 * The labelling switch (spec: intent-and-signals): the one setting behind
 * everything the classifier writes. Saves on change — there is nothing else
 * to fill in — and tells the reader what it costs, since it is the one
 * model call Deskbell makes per question outside the answer.
 */
export function LabellingSwitch({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const [checked, setChecked] = useState(on);
  const [pending, start] = useTransition();
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="classifyQuestions">Label every question</FieldLabel>
        <FieldDescription>
          One short chat-model call per question, off the visitor's path and within the daily token
          budget, writes its intent (why they asked), its signals (pushback, frustration, wanting a
          person) and its topic. Off means no call and no labels; the Usage page shows what was
          labelled before.
        </FieldDescription>
      </FieldContent>
      <Switch
        id="classifyQuestions"
        checked={checked}
        disabled={!canEdit || pending}
        onCheckedChange={(next) => {
          setChecked(next);
          start(async () => {
            const result = await saveClassifySwitch(next);
            if (result.error) {
              setChecked(!next);
              toast.error(result.error);
            } else {
              toast.success(next ? "Questions are labelled as they come in." : "Labelling is off.");
            }
          });
        }}
      />
    </Field>
  );
}
