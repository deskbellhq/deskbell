import { describe, expect, it } from "vitest";

import {
  chartRange,
  composition,
  deltaLabel,
  foldTotals,
  labelRows,
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

describe("labelRows and composition", () => {
  const segments = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  it("sums per label, folds segments, joins the previous period and ranks the remainder last", () => {
    const rows = labelRows(
      [
        { key: "billing", segment: "a", questions: 3, conversations: 2 },
        { key: "billing", segment: "zzz", questions: 1, conversations: 1 },
        { key: "other", segment: "a", questions: 9, conversations: 9 },
        { key: null, segment: "b", questions: 2, conversations: 2 },
        { key: "exports", segment: "b", questions: 5, conversations: 4 },
      ],
      segments,
      [{ key: "billing", questions: 1 }],
      "other",
    );
    expect(rows.map((r) => [r.key, r.questions, r.conversations, r.before])).toEqual([
      ["exports", 5, 4, 0],
      ["billing", 4, 3, 1],
      ["other", 9, 9, 0],
      [null, 2, 2, 0],
    ]);
    expect([...(rows[1]?.perSegment ?? [])]).toEqual([
      ["a", 3],
      ["__other__", 1],
    ]);
  });
  it("leaves before null without a previous period", () => {
    const [row] = labelRows(
      [{ key: "x", segment: "", questions: 1, conversations: 1 }],
      [{ id: "", label: "Questions" }],
      null,
      null,
    );
    expect(row?.before).toBeNull();
  });
  it("draws the leaders and folds the rest into one muted part", () => {
    const rows = labelRows(
      [
        { key: "how_to", segment: "", questions: 6, conversations: 6 },
        { key: "lookup", segment: "", questions: 2, conversations: 2 },
        { key: "other", segment: "", questions: 1, conversations: 1 },
        { key: null, segment: "", questions: 1, conversations: 1 },
      ],
      [{ id: "", label: "Questions" }],
      null,
      "other",
    );
    expect(composition(rows, 10, "other")).toEqual([
      { key: "how_to", share: 60, muted: false },
      { key: "lookup", share: 20, muted: false },
      { key: "__rest__", share: 20, muted: true },
    ]);
    expect(composition(rows, 0, "other")).toBeNull();
    expect(composition(rows.slice(0, 1), 6, "other")).toEqual([
      { key: "how_to", share: 100, muted: false },
    ]);
  });
});
