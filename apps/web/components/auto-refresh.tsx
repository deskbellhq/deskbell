"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-runs the current route's Server Components on an interval — the
 * no-websocket way to make derived state ("Indexing…", "Listening for your
 * widget…") resolve on screen. Mount it conditionally from the server side so
 * it disappears once nothing is pending. A hidden tab does not poll; it
 * refreshes once when it becomes visible again.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
