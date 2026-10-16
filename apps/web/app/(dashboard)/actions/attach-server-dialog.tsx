"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@deskbell/ui/components/dialog";
import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import { saveServer } from "./actions";
import { ConnectionFields } from "./connection-fields";

/**
 * Attaching a server (spec: actions-settings-ui): a dialog with the three
 * things a first connection needs and the rest behind Advanced. The
 * action redirects a successful attach to the server's own page, where
 * its tools have just been discovered and wait for a policy.
 */
export function AttachServerDialog({
  jwksUrl,
  variant = "default",
}: {
  jwksUrl: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveServer, undefined);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant}>
          <Plus />
          Attach server
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-xl">
        <form action={action} className="flex flex-col gap-6" data-testid="server-new">
          <DialogHeader>
            <DialogTitle>Attach an MCP server</DialogTitle>
            <DialogDescription>
              A remote server over Streamable HTTP or SSE. Deskbell lists its tools right after;
              every tool starts off until you allow it.
            </DialogDescription>
          </DialogHeader>
          <ConnectionFields server={null} canEdit idPrefix="new" jwksUrl={jwksUrl} collapsible />
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Attaching…" : "Attach"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
