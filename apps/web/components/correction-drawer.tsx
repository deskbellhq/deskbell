"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@deskbell/ui/components/drawer";
import { useIsMobile } from "@deskbell/ui/hooks/use-mobile";
import { type ReactNode, useCallback, useState } from "react";

import { CorrectionForm, type CorrectionFormProps } from "./correction-form";

/**
 * The correction form in a drawer (spec: corrections-source). Controlled
 * when a parent owns the open state (the row menu), self-managed when it
 * has a trigger of its own (the management page). Closes itself on save.
 */
export function CorrectionDrawer({
  form,
  title,
  description,
  trigger,
  open,
  onOpenChange,
}: {
  form: Omit<CorrectionFormProps, "onSaved" | "onCancel">;
  title: string;
  description?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [selfOpen, setSelfOpen] = useState(false);
  const isOpen = open ?? selfOpen;
  const setOpen = onOpenChange ?? setSelfOpen;
  const close = useCallback(() => setOpen(false), [setOpen]);

  return (
    <Drawer direction={isMobile ? "bottom" : "right"} open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DrawerTrigger asChild>{trigger}</DrawerTrigger> : null}
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle className="text-left">{title}</DrawerTitle>
          {description ? (
            <DrawerDescription className="text-left">{description}</DrawerDescription>
          ) : null}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-4">
          {isOpen ? <CorrectionForm {...form} onSaved={close} /> : null}
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
