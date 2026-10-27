import { INTENTS, SIGNALS } from "@deskbell/shared";
import { describe, expect, it } from "vitest";

import {
  conversationsHref,
  DEFAULT_VIEW,
  formatPeriod,
  INTENT_KEYS,
  isNarrowed,
  parseDay,
  parseView,
  resolveRange,
  SIGNAL_KEYS,
  shiftDay,
} from "./conversations-view";

describe("parseDay", () => {
  it("keeps a real calendar date in the chart's shape and drops the rest", () => {
    expect(parseDay("2026-09-22")).toBe("2026-09-22");
    expect(parseDay(["2026-09-22", "2026-09-23"])).toBe("2026-09-22");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("22-09-2026")).toBeNull();
    expect(parseDay("2026-09-22T10:00")).toBeNull();
    expect(parseDay("")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});

describe("parseView", () => {
  it("reads a relative period", () => {
    expect(parseView({ period: "7d" })).toEqual({ ...DEFAULT_VIEW, period: "7d" });
    expect(parseView({ period: "today", view: "attention" }).period).toBe("today");
  });
  it("reads a custom range from both ends, in order", () => {
    expect(parseView({ from: "2026-09-01", to: "2026-09-23" })).toEqual({
      ...DEFAULT_VIEW,
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-23",
    });
    expect(parseView({ from: "2026-09-23", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-23",
    });
  });
  it("falls back to all time when a range is half or broken", () => {
    expect(parseView({ from: "2026-09-01" }).period).toBe("all");
    expect(parseView({ from: "2026-09-01", to: "nope" }).period).toBe("all");
    expect(parseView({ period: "custom" }).period).toBe("all");
    expect(parseView({ period: "yesterday", view: "nope" })).toEqual(DEFAULT_VIEW);
  });
  it("lets period win over a stray range", () => {
    expect(parseView({ period: "30d", from: "2026-09-01", to: "2026-09-23" }).period).toBe("30d");
  });
  it("reads the quick view and every narrowing", () => {
    expect(
      parseView({
        view: "attention",
        outcome: "uncertain",
        feedback: "down",
        topic: "billing",
        intent: "request",
        signal: "wants_human",
        "ctx.account": "acc_1",
        user: "eu_1",
      }),
    ).toEqual({
      ...DEFAULT_VIEW,
      view: "attention",
      outcome: "uncertain",
      feedback: "down",
      topic: "billing",
      intent: "request",
      signal: "wants_human",
      context: { key: "account", id: "acc_1" },
      user: "eu_1",
    });
    expect(
      parseView({ outcome: "refused", feedback: "meh", intent: "angry", signal: "HOW_TO" }),
    ).toEqual(DEFAULT_VIEW);
  });
  it("reads the old filter segment as the narrowing it meant", () => {
    expect(parseView({ filter: "down" })).toMatchObject({ view: "all", feedback: "down" });
    expect(parseView({ filter: "uncertain" })).toMatchObject({ outcome: "uncertain" });
    expect(parseView({ filter: "all" })).toEqual(DEFAULT_VIEW);
    // The new spelling wins when both are present.
    expect(parseView({ filter: "down", feedback: "up" }).feedback).toBe("up");
  });
});

describe("intent and signal narrowing", () => {
  it("spells the keys the way the shared package does", () => {
    expect([...INTENT_KEYS]).toEqual([...INTENTS]);
    expect([...SIGNAL_KEYS]).toEqual([...SIGNALS]);
  });
});

describe("conversationsHref", () => {
  it("omits the defaults, never writes the old filter, and keeps the pathname", () => {
    expect(conversationsHref("/conversations", parseView({}))).toBe("/conversations");
    expect(conversationsHref("/conversations/c1", parseView({ filter: "down" }))).toBe(
      "/conversations/c1?feedback=down",
    );
    expect(conversationsHref("/conversations", parseView({ period: "7d" }))).toBe(
      "/conversations?period=7d",
    );
    expect(
      conversationsHref(
        "/conversations",
        parseView({
          view: "attention",
          outcome: "uncertain",
          from: "2026-09-22",
          to: "2026-09-22",
        }),
      ),
    ).toBe("/conversations?view=attention&from=2026-09-22&to=2026-09-22&outcome=uncertain");
    expect(conversationsHref("/conversations", parseView({ period: "7d", intent: "how_to" }))).toBe(
      "/conversations?period=7d&intent=how_to",
    );
    expect(conversationsHref("/conversations", parseView({ signal: "pushback" }))).toBe(
      "/conversations?signal=pushback",
    );
  });
  it("round-trips through parseView", () => {
    const view = parseView({
      view: "attention",
      feedback: "down",
      topic: "exports",
      "ctx.site": "s1",
      from: "2026-09-01",
      to: "2026-09-23",
    });
    const href = conversationsHref("/conversations", view);
    const params = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseView(params)).toEqual(view);
  });
});

describe("isNarrowed", () => {
  it("is false for a quick view and a period alone", () => {
    expect(isNarrowed(parseView({ view: "attention", period: "7d" }))).toBe(false);
    expect(isNarrowed(parseView({ topic: "billing" }))).toBe(true);
    expect(isNarrowed(parseView({ outcome: "certain" }))).toBe(true);
  });
});

describe("resolveRange", () => {
  const today = "2026-09-23";
  it("is null for all time and the fixed days for a custom range", () => {
    expect(resolveRange(parseView({}), today)).toBeNull();
    expect(resolveRange(parseView({ from: "2026-09-01", to: "2026-09-02" }), today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
    });
  });
  it("counts calendar days ending today, like the chart's toggle", () => {
    expect(resolveRange(parseView({ period: "today" }), today)).toEqual({ from: today, to: today });
    expect(resolveRange(parseView({ period: "7d" }), today)).toEqual({
      from: "2026-09-17",
      to: today,
    });
    expect(resolveRange(parseView({ period: "90d" }), today)).toEqual({
      from: "2026-06-26",
      to: today,
    });
  });
});

describe("shiftDay", () => {
  it("crosses months and years in UTC", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("formatPeriod", () => {
  it("names a preset, a day, or a span", () => {
    expect(formatPeriod(parseView({ period: "7d" }))).toBe("Last 7 days");
    expect(formatPeriod(parseView({ from: "2026-09-22", to: "2026-09-22" }))).toBe("Sep 22");
    expect(formatPeriod(parseView({ from: "2026-09-01", to: "2026-09-23" }))).toBe(
      "Sep 1 – Sep 23",
    );
  });
});
