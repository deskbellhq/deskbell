"use client";

import {
  type ProjectTopics,
  TOPIC_DESCRIPTION_MAX,
  TOPIC_LIMIT,
  TOPIC_NAME_MAX,
  topicsToText,
} from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { useActionState } from "react";

import { saveTopics } from "./actions";

/**
 * The topics form (spec: question-topics): one topic per line, a name and
 * an optional description after a colon. The description is what the
 * classifier is told, so writing it is writing the rule.
 */
export function TopicsForm({ topics, canEdit }: { topics: ProjectTopics; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveTopics, undefined);

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="topics">Topics</FieldLabel>
            <FieldDescription>
              One per line, as <code>Name: what belongs here</code>. Up to {TOPIC_LIMIT} topics,
              names under {TOPIC_NAME_MAX} characters, descriptions under {TOPIC_DESCRIPTION_MAX}. A
              question that fits none of them is counted under <strong>Other</strong>.
            </FieldDescription>
          </FieldContent>
          <textarea
            id="topics"
            name="topics"
            defaultValue={topicsToText(topics)}
            rows={Math.min(Math.max(topics.length + 2, 6), TOPIC_LIMIT + 1)}
            spellCheck={false}
            disabled={!canEdit}
            placeholder={
              "Billing: invoices, plans, payment methods\nExports: feeds, files, formats, schedules"
            }
            className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </Field>
      </FieldGroup>
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved. Questions asked from now on are labelled with these topics; to apply them to the
          questions you already have, re-label below.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change topics.</p>
      )}
    </form>
  );
}
