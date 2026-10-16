"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deskbell/ui/components/alert-dialog";
import { Button } from "@deskbell/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@deskbell/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { toast } from "@deskbell/ui/components/sonner";
import { Switch } from "@deskbell/ui/components/switch";
import { EllipsisVertical, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteServer, refreshTools, setServerEnabled } from "../../actions";

/**
 * The controls in a server page's header (spec: actions-settings-ui): the
 * switch, a refresh, and removal behind a confirmation — a server's
 * policies go with it, which is not something to do from a stray click.
 * Each saves on its own and says so in a toast. A server that answers only
 * to a visitor's token (spec: visitor-token-actions) asks for one before it
 * refreshes; the token is sent once and not kept anywhere.
 */
export function ServerHeaderActions({
  server,
}: {
  server: {
    id: string;
    name: string;
    enabled: boolean;
    toolCount: number;
    needsDiscoveryToken: boolean;
  };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(server.enabled);
  const [toggling, startToggle] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [removing, startRemove] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [askToken, setAskToken] = useState(false);
  const [discoveryToken, setDiscoveryToken] = useState("");

  const toggle = (next: boolean) => {
    setEnabled(next);
    startToggle(async () => {
      const result = await setServerEnabled(server.id, next);
      if (result.error) {
        setEnabled(!next);
        toast.error(result.error);
      } else {
        toast.success(next ? `${server.name} is on` : `${server.name} is off`, {
          description: next
            ? "Its allowed and confirmed tools are offered again."
            : "None of its tools are offered until it is switched back on.",
        });
      }
    });
  };

  const refresh = (token?: string) =>
    startRefresh(async () => {
      const result = await refreshTools(server.id, token);
      setDiscoveryToken("");
      if (result.error) toast.error("Could not list tools", { description: result.error });
      else
        toast.success(`${result.tools} ${result.tools === 1 ? "tool" : "tools"} found`, {
          description: "Tools the server no longer lists lost their policy.",
        });
    });

  const onRefreshClick = () => {
    if (server.needsDiscoveryToken) setAskToken(true);
    else refresh();
  };

  const refreshWithToken = () => {
    setAskToken(false);
    refresh(discoveryToken);
  };

  const remove = () =>
    startRemove(async () => {
      const result = await deleteServer(server.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${server.name} removed`);
      router.push("/actions/servers");
    });

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 pr-2">
        <Switch
          id="server-enabled"
          checked={enabled}
          onCheckedChange={toggle}
          disabled={toggling}
          aria-label="Enabled"
        />
        <Label htmlFor="server-enabled" className="text-sm text-muted-foreground">
          {enabled ? "On" : "Off"}
        </Label>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefreshClick}
        disabled={refreshing}
      >
        <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
        {refreshing ? "Refreshing…" : "Refresh tools"}
      </Button>
      <Dialog open={askToken} onOpenChange={setAskToken}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              refreshWithToken();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>List tools with a visitor's token</DialogTitle>
              <DialogDescription>
                This server answers only to a visitor's token, so the instance cannot list its tools
                by itself. Paste a token it accepts. It is used once for the listing and not kept.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="discovery-token">Token</Label>
              <Input
                id="discovery-token"
                type="password"
                autoComplete="off"
                value={discoveryToken}
                onChange={(e) => setDiscoveryToken(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAskToken(false)}>
                Cancel
              </Button>
              <Button type="submit">Refresh tools</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Server actions" disabled={removing}>
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
            Remove server
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {server.toolCount > 0
                ? `Its ${server.toolCount} tool ${server.toolCount === 1 ? "policy goes" : "policies go"} with it and the widget stops offering its tools at once. `
                : "The widget stops offering its tools at once. "}
              Past conversations keep what already happened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Remove server</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
