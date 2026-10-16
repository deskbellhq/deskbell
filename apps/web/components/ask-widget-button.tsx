"use client";

import { Button } from "@deskbell/ui/components/button";
import { MessageCircleQuestion } from "lucide-react";

/** Opens the dashboard's embedded widget — the same event the sidebar uses. */
export function AskWidgetButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => window.dispatchEvent(new Event("deskbell:open"))}
    >
      <MessageCircleQuestion />
      Ask a question
    </Button>
  );
}
