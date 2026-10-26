import { describe, expect, it } from "vitest";

import {
  conversationsHref,
  formatPeriod,
  parseDay,
  parseFilter,
  parseView,
  resolveRange,
  shiftDay,
} from "./conversations-view";

describe("parseFilter", () => {
  it("accepts the three views and falls back to all", () => {
    expect(parseFilter("uncertain")).toBe("uncertain");
    expect(parseFilter("down")).toBe("down");
    expect(parseFilter(["down", "all"])).toBe("down");
    expect(parseFilter("everything")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});

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
    expect(parseView({ period: "7d" })).toEqual({
      filter: "all",
      period: "7d",
      from: null,
      to: null,
      topic: null,
      context: null,
      user: null,
    });
    expect(parseView({ period: "today", filter: "down" }).period).toBe("today");
  });
  it("reads a custom range from both ends, in order", () => {
    expect(parseView({ from: "2026-09-01", to: "2026-09-23" })).toEqual({
      filter: "all",
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-23",
      topic: null,
      context: null,
      user: null,
    });
    expect(parseView({ from: "2026-09-23", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-23",
      topic: null,
      context: null,
      user: null,
    });
  });
  it("falls back to all time when a range is half or broken", () => {
    expect(parseView({ from: "2026-09-01" }).period).toBe("all");
    expect(parseView({ from: "2026-09-01", to: "nope" }).period).toBe("all");
    expect(parseView({ period: "custom" }).period).toBe("all");
    expect(parseView({ period: "yesterday", filter: "nope" })).toEqual({
      filter: "all",
      period: "all",
      from: null,
      to: null,
      topic: null,
      context: null,
      user: null,
    });
  });
  it("lets period win over a stray range", () => {
    expect(parseView({ period: "30d", from: "2026-09-01", to: "2026-09-23" }).period).toBe("30d");
  });
});

describe("conversationsHref", () => {
  it("omits the defaults and keeps the pathname", () => {
    expect(conversationsHref("/conversations", parseView({}))).toBe("/conversations");
    expect(conversationsHref("/conversations/c1", parseView({ filter: "down" }))).toBe(
      "/conversations/c1?filter=down",
    );
    expect(conversationsHref("/conversations", parseView({ period: "7d" }))).toBe(
      "/conversations?period=7d",
    );
    expect(
      conversationsHref(
        "/conversations",
        parseView({ filter: "uncertain", from: "2026-09-22", to: "2026-09-22" }),
      ),
    ).toBe("/conversations?filter=uncertain&from=2026-09-22&to=2026-09-22");
  });
  it("round-trips through parseView", () => {
    const view = parseView({ filter: "down", from: "2026-09-01", to: "2026-09-23" });
    const href = conversationsHref("/conversations", view);
    const params = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseView(params)).toEqual(view);
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
    expect(formatPeriod(parseView({}))).toBe("All time");
    expect(formatPeriod(parseView({ period: "30d" }))).toBe("Last 30 days");
    expect(formatPeriod(parseView({ from: "2026-09-22", to: "2026-09-22" }))).toBe("Sep 22");
    expect(formatPeriod(parseView({ from: "2026-09-01", to: "2026-09-23" }))).toBe(
      "Sep 1 – Sep 23",
    );
  });
});

describe("topic and context filters", () => {
  it("reads a topic key and the first ctx.<key> pair, dropping bad spellings", () => {
    const view = parseView({ topic: "billing", "ctx.account": "acc_1", "ctx.site": "s" });
    expect(view.topic).toBe("billing");
    expect(view.context).toEqual({ key: "account", id: "acc_1" });
    expect(parseView({ topic: "Not A Key", "ctx.1bad": "x" })).toMatchObject({
      topic: null,
      context: null,
      user: null,
    });
  });

  it("writes them back and round-trips", () => {
    const view = parseView({ period: "7d", topic: "billing", "ctx.account": "acc 1" });
    const href = conversationsHref("/conversations", view);
    expect(href).toBe("/conversations?period=7d&topic=billing&ctx.account=acc+1");
    const url = new URL(href, "http://x");
    expect(parseView(Object.fromEntries(url.searchParams))).toEqual(view);
  });
});

describe("visitor filter", () => {
  it("reads an end-user id, drops anything else, and round-trips", () => {
    expect(parseView({ user: "eu_abc-1" }).user).toBe("eu_abc-1");
    expect(parseView({ user: "not an id" }).user).toBeNull();
    expect(parseView({ user: "x".repeat(65) }).user).toBeNull();
    const view = parseView({ period: "7d", user: "eu_abc", "ctx.site": "s1" });
    const href = conversationsHref("/conversations", view);
    expect(href).toBe("/conversations?period=7d&ctx.site=s1&user=eu_abc");
    expect(parseView(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(view);
  });
});
