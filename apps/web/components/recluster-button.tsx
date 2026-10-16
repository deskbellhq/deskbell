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
  AlertDialogTrigger,
} from "@deskbell/ui/components/alert-dialog";
import { Button } from "@deskbell/ui/components/button";
import { useTransition } from "react";

/**
 * Re-cluster behind a confirmation (spec: gap-clusters): the action drops
 * every cluster in the project, resolved state included, before the worker
 * rebuilds them, and that is not something to do from a stray click.
 */
export function ReclusterButton({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? "Re-clustering…" : "Re-cluster"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rebuild every gap cluster?</AlertDialogTitle>
          <AlertDialogDescription>
            Every cluster in this project is dropped and rebuilt from the questions, with the
            embedding model and similarity threshold configured now. Clusters you marked resolved
            lose that mark: the rebuilt groups are a different set of questions.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction onClick={() => startTransition(() => action())}>
            Rebuild clusters
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
