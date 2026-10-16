"use client";

import { Button } from "@deskbell/ui/components/button";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { useActionState } from "react";

import { setDailyTokenBudget } from "@/app/settings/install/actions";

/**
 * The project's daily LLM ceiling (spec: widget-abuse-protection). Request
 * rates are the operator's business and live in env; this one is the project's,
 * because it is about money rather than infrastructure.
 */
export function TokenBudget({ budget, usedToday }: { budget: number; usedToday: number }) {
  const [state, formAction, pending] = useActionState(setDailyTokenBudget, {});
  const share = budget > 0 ? Math.min(100, Math.round((usedToday / budget) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-col gap-1.5">
          <Label htmlFor="dailyTokenBudget">Daily token budget</Label>
          <Input
            id="dailyTokenBudget"
            name="dailyTokenBudget"
            type="number"
            min={0}
            step={1000}
            defaultValue={budget}
            className="font-mono"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <p className="text-xs text-muted-foreground">0 means unlimited.</p>
        {state?.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      </form>

      <div className="flex flex-col gap-1.5 rounded-lg border p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">Used today (UTC)</span>
          <span className="font-mono text-sm">
            {usedToday.toLocaleString("en-US")}
            {budget > 0 && ` / ${budget.toLocaleString("en-US")}`}
          </span>
        </div>
        {budget > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${share >= 100 ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${share}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
