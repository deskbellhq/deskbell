"use client";

import { Button } from "@deskbell/ui/components/button";
import { Lock, X } from "lucide-react";

import { removeAllowedOrigin } from "@/app/settings/install/actions";

import { AddOriginForm } from "./add-origin-form";

/**
 * `selfOrigin` is this deployment's own origin, which the guard always allows
 * (spec: widget-abuse-protection) — the dashboard dogfoods the widget, and the
 * allowlist exists to fence out other people's pages, not the operator's own.
 * It is shown as a row rather than left implicit: a trust rule nobody can see
 * is the kind that surprises someone during a security review.
 */
export function OriginAllowlist({
  origins,
  selfOrigin,
}: {
  origins: string[];
  selfOrigin: string;
}) {
  // Adding it by hand is harmless but reads as if it were doing something.
  const listed = origins.filter((o) => o !== selfOrigin);

  return (
    <div className="flex flex-col gap-4">
      <AddOriginForm />
      <ul className="flex flex-col divide-y rounded-lg border">
        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="font-mono text-xs text-muted-foreground">{selfOrigin}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />
            This dashboard — always allowed
          </span>
        </li>
        {listed.map((origin) => (
          <li key={origin} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="font-mono text-xs">{origin}</span>
            <form action={removeAllowedOrigin.bind(null, origin)}>
              <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${origin}`}>
                <X />
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
