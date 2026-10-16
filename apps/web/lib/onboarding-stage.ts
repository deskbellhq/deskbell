import type { OnboardingStatus } from "./onboarding";

/**
 * The one line the getting-started page says about where the project is
 * (spec: overview-getting-started). Pure, so the page, the tests and any
 * future banner derive it the same way.
 *
 * The pill names the first undone step in step order, not whatever happens
 * to be true. A project with answers but no source (a headless client can do
 * that) reads "Waiting for your docs", because adding docs is what the
 * operator should do next.
 */
export type StageKey =
  | "live"
  | "no-source"
  | "indexing"
  | "source-error"
  | "unasked"
  | "not-installed"
  | "listening";

export type StageTone = "success" | "muted" | "busy" | "destructive";

export interface OnboardingStage {
  key: StageKey;
  label: string;
  tone: StageTone;
}

export function onboardingStage(status: OnboardingStatus): OnboardingStage {
  if (status.complete) {
    return {
      key: "live",
      label: `Live on ${status.firstForeignOrigin ?? "your site"}`,
      tone: "success",
    };
  }
  if (!status.sourceAdded)
    return { key: "no-source", label: "Waiting for your docs", tone: "muted" };
  if (!status.sourceReady) {
    // A source that stopped must not sit under "Indexing…" forever.
    return status.sourceSyncing
      ? { key: "indexing", label: "Indexing…", tone: "busy" }
      : { key: "source-error", label: "Crawl failed", tone: "destructive" };
  }
  if (!status.asked)
    return { key: "unasked", label: "Waiting for the first question", tone: "busy" };
  // "Listening" before any origin is allowed would describe a beacon nothing
  // can send — in production an unconfigured project is refused outright.
  if (!status.originAllowed)
    return { key: "not-installed", label: "Ready to install", tone: "muted" };
  return { key: "listening", label: "Listening for your widget", tone: "busy" };
}

/**
 * Whether something can resolve without the operator touching anything:
 * indexing, an answer landing, or the install beacon from their site. The
 * page polls only while this is true.
 */
export function onboardingPending(status: OnboardingStatus): boolean {
  return (
    status.sourceSyncing ||
    (status.sourceReady && !status.asked) ||
    (status.originAllowed && !status.widgetLive)
  );
}
