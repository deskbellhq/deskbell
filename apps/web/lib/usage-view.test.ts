import { describe, expect, it } from "vitest";

import { parseUsageView, usageHref, withFilter, withoutFilter } from "./usage-view";

describe("parseUsageView", () => {
  it("reads period, split, breakdown and context filters", () => {
    expect(
      parseUsageView({
        period: "7d",
        split: "user_type",
        by: "account",
        "ctx.user_type": "customer",
        "ctx.account": ["acc_1", "acc_2"],
      }),
    ).toEqual({
      period: "7d",
      split: "user_type",
      by: "account",
      filters: [
        { key: "user_type", id: "customer" },
        { key: "account", id: "acc_1" },
      ],
    });
  });

  it("drops what is not a context key or a usable id, and falls back on the period", () => {
    expect(
      parseUsageView({
        period: "yesterday",
        split: "1bad",
        by: "has space",
        "ctx.": "x",
        "ctx.account": "",
        "ctx.site": "x".repeat(129),
        "ctx.ok": "1",
      }),
    ).toEqual({ period: "30d", split: null, by: null, filters: [{ key: "ok", id: "1" }] });
  });
});

describe("usageHref", () => {
  it("omits defaults and writes filters as ctx.<key>", () => {
    expect(usageHref("/usage", parseUsageView({}))).toBe("/usage");
    expect(
      usageHref("/usage", {
        period: "all",
        split: "user_type",
        by: null,
        filters: [{ key: "account", id: "acc 1" }],
      }),
    ).toBe("/usage?period=all&split=user_type&ctx.account=acc+1");
  });

  it("round-trips through the parser", () => {
    const view = parseUsageView({ period: "90d", by: "account", "ctx.user_type": "internal" });
    const url = new URL(usageHref("/usage", view), "http://x");
    expect(parseUsageView(Object.fromEntries(url.searchParams))).toEqual(view);
  });
});

describe("filters", () => {
  const view = parseUsageView({ "ctx.account": "a" });
  it("replace one key and remove one key", () => {
    expect(withFilter(view, { key: "account", id: "b" }).filters).toEqual([
      { key: "account", id: "b" },
    ]);
    expect(withFilter(view, { key: "site", id: "s" }).filters).toHaveLength(2);
    expect(withoutFilter(view, "account").filters).toEqual([]);
  });
});
