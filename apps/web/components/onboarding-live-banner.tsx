import { Button } from "@deskbell/ui/components/button";
import { CircleCheck } from "lucide-react";

import { dismissOnboarding } from "@/app/(dashboard)/actions";
import type { OnboardingStatus } from "@/lib/onboarding";

/**
 * The line above the analytics once the widget has gone live on the
 * operator's own site (spec: overview-getting-started). It replaces the
 * getting-started page the moment the install beacon lands and stays until
 * dismissed; the steps themselves are gone, because they are all done.
 */
export function OnboardingLiveBanner({ status }: { status: OnboardingStatus }) {
  if (!status.complete || status.dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
      <CircleCheck className="size-5 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">
          Your widget is live{status.firstForeignOrigin ? ` on ${status.firstForeignOrigin}` : ""}
        </span>
        <span className="text-xs text-muted-foreground">
          It answers from your docs, with sources — everything below fills up from here.
        </span>
      </div>
      <form action={dismissOnboarding}>
        <Button type="submit" variant="outline" size="sm">
          Done
        </Button>
      </form>
    </div>
  );
}
