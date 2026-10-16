"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * The clipboard for every copy control (spec: gap-task-brief). The async
 * clipboard API when the page has it; otherwise a selected off-screen
 * textarea and `execCommand("copy")`, which is what a self-hosted dashboard
 * served over plain HTTP on a LAN gets, since `navigator.clipboard` exists
 * only in secure contexts. The outcome shows on the control itself for a
 * moment — "Copied", or "Copy failed" rather than nothing — and resets.
 */
export function useCopy(resetMs = 1600): { state: CopyState; copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    (text: string) => {
      const settle = (next: CopyState) => {
        setState(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), resetMs);
      };
      writeClipboard(text).then(
        () => settle("copied"),
        () => settle("failed"),
      );
    },
    [resetMs],
  );

  return { state, copy };
}

/** The label of a copy control across its three states, so every control says the same thing. */
export function copyLabel(state: CopyState, idle: string): string {
  return state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : idle;
}

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Denied or unavailable mid-flight; the textarea path below still works.
    }
  }
  if (!legacyCopy(text)) throw new Error("clipboard unavailable");
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
