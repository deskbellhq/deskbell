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
import { toast } from "@deskbell/ui/components/sonner";
import { useState, useTransition } from "react";

import { relabelQuestions } from "./actions";

/** The re-label, behind a confirmation: it clears every label before writing new ones. */
export function RelabelButton({ labelled }: { labelled: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={pending}>
          {pending ? "Queuing…" : "Re-label"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-label every question?</AlertDialogTitle>
          <AlertDialogDescription>
            The {labelled} {labelled === 1 ? "label" : "labels"} written so far are cleared and
            every question is labelled again against the current list, one model call each, within
            the project's daily budget. The Usage page shows topics again as the worker gets through
            them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                const result = await relabelQuestions();
                if (result.error) toast.error(result.error);
                else toast.success("Re-labelling queued.");
                setOpen(false);
              })
            }
          >
            Re-label
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
