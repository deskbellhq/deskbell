"use client";

import { Button } from "@deskbell/ui/components/button";
import { SidebarGroup } from "@deskbell/ui/components/sidebar";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { GITHUB_URL } from "@/lib/links";

const DISMISS_KEY = "deskbell.star-card-dismissed";

/**
 * Dismissible star-us card (spec: dashboard-ia-settings). Dismissal lives in
 * localStorage — a promo card does not justify a schema migration, and
 * per-browser scope is acceptable. Hidden until mounted so a dismissed card
 * never flashes on load.
 */
export function GithubStarCard({ badge }: { badge?: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISS_KEY) === null);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage unavailable — the card just comes back next load.
    }
  };

  return (
    <SidebarGroup>
      <div className="relative rounded-lg border bg-card p-3">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 size-6 text-muted-foreground"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <X />
        </Button>
        <p className="pr-6 text-sm font-medium">Star Deskbell on GitHub</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Follow releases and help grow the project.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubMark />
              Star
            </a>
          </Button>
          {badge}
        </div>
      </div>
    </SidebarGroup>
  );
}

/* lucide's brand icons are deprecated, so the mark ships inline. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
