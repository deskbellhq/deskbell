import { describe, expect, it } from "vitest";
import type { OnboardingStatus } from "./onboarding";
import { onboardingPending, onboardingStage } from "./onboarding-stage";

const empty: OnboardingStatus = {
  sourceAdded: false,
  sourceReady: false,
  sourceSyncing: false,
  asked: false,
  originAllowed: false,
  widgetLive: false,
  firstForeignOrigin: null,
  complete: false,
  dismissed: false,
};

const at = (over: Partial<OnboardingStatus>): OnboardingStatus => ({ ...empty, ...over });

describe("onboardingStage", () => {
  it("waits for docs on an empty project", () => {
    expect(onboardingStage(empty)).toMatchObject({ key: "no-source", tone: "muted" });
  });

  it("says indexing while a source is syncing and failed once none is", () => {
    expect(onboardingStage(at({ sourceAdded: true, sourceSyncing: true }))).toMatchObject({
      key: "indexing",
      tone: "busy",
    });
    expect(onboardingStage(at({ sourceAdded: true }))).toMatchObject({
      key: "source-error",
      label: "Crawl failed",
      tone: "destructive",
    });
  });

  it("waits for the first question once a source is ready", () => {
    expect(onboardingStage(at({ sourceAdded: true, sourceReady: true }))).toMatchObject({
      key: "unasked",
      tone: "busy",
    });
  });

  it("is ready to install after the first answer and listening once an origin is allowed", () => {
    const asked = at({ sourceAdded: true, sourceReady: true, asked: true });
    expect(onboardingStage(asked)).toMatchObject({ key: "not-installed", tone: "muted" });
    expect(onboardingStage({ ...asked, originAllowed: true })).toMatchObject({
      key: "listening",
      tone: "busy",
    });
  });

  it("names the site once live", () => {
    expect(
      onboardingStage(
        at({
          sourceAdded: true,
          sourceReady: true,
          asked: true,
          originAllowed: true,
          widgetLive: true,
          firstForeignOrigin: "https://docs.example.com",
          complete: true,
        }),
      ),
    ).toEqual({ key: "live", label: "Live on https://docs.example.com", tone: "success" });
  });

  it("orders by what to do next, not by what happens to be true", () => {
    // Answers exist but no source does — the browser-suite seed, and what a
    // headless client produces. The next thing to do is still add docs.
    expect(onboardingStage(at({ asked: true }))).toMatchObject({ key: "no-source" });
    // An allowed origin with a failed crawl is still a failed crawl.
    expect(
      onboardingStage(at({ sourceAdded: true, asked: true, originAllowed: true })),
    ).toMatchObject({ key: "source-error" });
  });
});

describe("onboardingPending", () => {
  it("polls only while something can resolve on its own", () => {
    expect(onboardingPending(empty)).toBe(false);
    expect(onboardingPending(at({ sourceAdded: true, sourceSyncing: true }))).toBe(true);
    expect(onboardingPending(at({ sourceAdded: true, sourceReady: true }))).toBe(true);
    expect(onboardingPending(at({ sourceAdded: true, sourceReady: true, asked: true }))).toBe(
      false,
    );
    expect(
      onboardingPending(
        at({ sourceAdded: true, sourceReady: true, asked: true, originAllowed: true }),
      ),
    ).toBe(true);
    expect(
      onboardingPending(
        at({
          sourceAdded: true,
          sourceReady: true,
          asked: true,
          originAllowed: true,
          widgetLive: true,
        }),
      ),
    ).toBe(false);
  });
});
