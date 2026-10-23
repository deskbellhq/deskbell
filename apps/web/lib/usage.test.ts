import { describe, expect, it } from "vitest";

import {
  chartRange,
  deltaLabel,
  foldTotals,
  NO_SEGMENT,
  OTHER_SEGMENT,
  percent,
  pickSegments,
  weeklyRows,
  weekStart,
  zeroFilledDays,
} from "./usage";

const seg = (segment: string, conversations: number, name: string | null = null) => ({
  segment,
  name,
  conversations,
});

describe("pickSegments", () => {
  it("orders by size, names from the host, and adds the missing-key series last", () => {
    expect(
      pickSegments(
        [seg("internal", 2, "Staff"), seg("customer", 10), seg(NO_SEGMENT, 1)],
        "user_type",
      ),
    ).toEqual([
      { id: "customer", label: "customer" },
      { id: "internal", label: "Staff" },
      { id: NO_SEGMENT, label: "No user_type" },
    ]);
  });

  it("folds the tail into Other without pushing a kept value out", () => {
    const rows = Array.from({ length: 8 }, (_, i) => seg(`a${i}`, 8 - i));
    const picked = pickSegments(rows, "account", 4);
    expect(picked.map((s) => s.id)).toEqual(["a0", "a1", "a2", OTHER_SEGMENT]);
    expect(pickSegments(rows.slice(0, 4), "account", 4)).toHaveLength(4);
  });

  it("drops empty values", () => {
    expect(pickSegments([seg("x", 0), seg(NO_SEGMENT, 0)], "k")).toEqual([]);
  });
});

describe("foldTotals", () => {
  it("sums raw segments onto the kept series, in series order, with zeros for the empty", () => {
    const segments = [
      { id: "a", label: "a" },
      { id: OTHER_SEGMENT, label: "Other" },
    ];
    const rows = [
      { segment: "b", n: 2 },
      { segment: "a", n: 1 },
      { segment: "c", n: 3 },
    ];
    expect(
      foldTotals(
        rows,
        segments,
        (into, row) => ({ ...into, n: into.n + row.n }),
        (segment) => ({ segment, n: 0 }),
      ),
    ).toEqual([
      { segment: "a", n: 1 },
      { segment: OTHER_SEGMENT, n: 5 },
    ]);
  });
});

describe("zeroFilledDays and weeklyRows", () => {
  const segments = [
    { id: "x", label: "x" },
    { id: "y", label: "y" },
  ];
  it("fills every day and folds unknown segments", () => {
    const rows = zeroFilledDays(
      [
        { day: "2026-10-05", segment: "x", questions: 2 },
        { day: "2026-10-06", segment: "z", questions: 1 },
      ],
      { from: "2026-10-05", to: "2026-10-07" },
      segments,
    );
    expect(rows).toEqual([
      { date: "2026-10-05", s0: 2, s1: 0 },
      { date: "2026-10-06", s0: 0, s1: 0 },
      { date: "2026-10-07", s0: 0, s1: 0 },
    ]);
  });

  it("rolls days into Monday weeks", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    const weekly = weeklyRows([
      { date: "2026-10-04", s0: 1 },
      { date: "2026-10-05", s0: 2 },
      { date: "2026-10-06", s0: 3 },
    ]);
    expect(weekly).toEqual([
      { date: "2026-09-28", s0: 1 },
      { date: "2026-10-05", s0: 5 },
    ]);
  });
});

describe("chartRange, deltaLabel, percent", () => {
  it("covers the period, or 90 days when unbounded", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(chartRange(new Date("2026-10-16T12:00:00Z"), now)).toEqual({
      from: "2026-10-16",
      to: "2026-10-23",
    });
    expect(chartRange(null, now)).toEqual({ from: "2026-07-26", to: "2026-10-23" });
  });

  it("labels a delta and a share", () => {
    expect(deltaLabel(5, 3)).toBe("+2");
    expect(deltaLabel(3, 5)).toBe("-2");
    expect(deltaLabel(3, 3)).toBe("no change");
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBeNull();
  });
});
