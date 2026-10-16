"use client";

import { Button } from "@deskbell/ui/components/button";
import { useActionState } from "react";

import type { ServerView } from "@/lib/actions/settings";
import { saveServer } from "../../actions";
import { ConnectionFields } from "../../connection-fields";

/**
 * The connection form on a server's page (spec: actions-settings-ui). A
 * form, saved whole, because a credential is typed and submitted rather
 * than flipped; the switch and the refresh live in the header.
 */
export function ConnectionForm({
  server,
  canEdit,
  jwksUrl,
}: {
  server: ServerView;
  canEdit: boolean;
  jwksUrl: string;
}) {
  const [state, action, pending] = useActionState(saveServer, undefined);
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="serverId" value={server.id} />
      <ConnectionFields server={server} canEdit={canEdit} idPrefix={server.id} jwksUrl={jwksUrl} />
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.saved && !state.error ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`${server.id}-saved`}
          role="status"
        >
          Saved.
          {state.discovered !== undefined
            ? ` ${state.discovered} ${state.discovered === 1 ? "tool" : "tools"} found.`
            : ""}
          {state.discoveryError ? ` Could not list tools: ${state.discoveryError}` : ""}
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change actions.</p>
      )}
    </form>
  );
}
