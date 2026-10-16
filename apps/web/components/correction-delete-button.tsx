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
import { Trash2 } from "lucide-react";
import { useTransition } from "react";

/**
 * Delete an answer behind a confirmation (spec: corrections-source): the
 * chunks go with it and the assistant stops answering from it on the next
 * question, which is not something to do from a stray click.
 */
export function CorrectionDeleteButton({
  question,
  action,
}: {
  question: string;
  action: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={pending}
          aria-label={`Delete answer: ${question}`}
        >
          <Trash2 />
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this answer?</AlertDialogTitle>
          <AlertDialogDescription>
            “{question}” stops being part of what the assistant answers from. A gap it was written
            for keeps its status until the question comes up again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => startTransition(() => action())}>
            Delete answer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
