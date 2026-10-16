import { describe, expect, it } from "vitest";

import { secondsUntilUtcMidnight, utcDay } from "./budget";
import { type Bucket, bucketKey, windowResetIn } from "./rate-limit";

const minute: Bucket = { scope: "ask:ip:min", subject: "abc", windowSeconds: 60, limit: 10 };
const hour: Bucket = { scope: "ask:ip:hr", subject: "abc", windowSeconds: 3600, limit: 100 };

describe("bucketKey", () => {
  it("is the same key for two requests inside one window", () => {
    const a = bucketKey(minute, new Date("2026-08-24T10:00:01Z"));
    const b = bucketKey(minute, new Date("2026-08-24T10:00:59Z"));
    expect(a).toBe(b);
  });

  it("rolls over at the window boundary", () => {
    const before = bucketKey(minute, new Date("2026-08-24T10:00:59.999Z"));
    const after = bucketKey(minute, new Date("2026-08-24T10:01:00Z"));
    expect(after).not.toBe(before);
  });

  it("keeps scopes apart, so reads never eat the ask allowance", () => {
    const now = new Date("2026-08-24T10:00:00Z");
    const read: Bucket = { ...minute, scope: "read:ip:min" };
    expect(bucketKey(read, now)).not.toBe(bucketKey(minute, now));
  });

  it("keeps subjects apart", () => {
    const now = new Date("2026-08-24T10:00:00Z");
    expect(bucketKey({ ...minute, subject: "xyz" }, now)).not.toBe(bucketKey(minute, now));
  });

  it("keeps window lengths apart even at a boundary they share", () => {
    const now = new Date("2026-08-24T10:00:00Z");
    expect(bucketKey(hour, now)).not.toBe(bucketKey(minute, now));
  });
});

describe("windowResetIn", () => {
  it("counts down to the end of the current window", () => {
    expect(windowResetIn(minute, new Date("2026-08-24T10:00:00Z"))).toBe(60);
    expect(windowResetIn(minute, new Date("2026-08-24T10:00:45Z"))).toBe(15);
    expect(windowResetIn(hour, new Date("2026-08-24T10:30:00Z"))).toBe(1800);
  });

  it("never reports zero — a Retry-After of 0 invites an instant retry", () => {
    for (let second = 0; second < 120; second++) {
      const at = new Date(Date.UTC(2026, 7, 24, 10, 0, second));
      expect(windowResetIn(minute, at)).toBeGreaterThan(0);
    }
  });
});

describe("budget windows", () => {
  it("uses UTC days, so a budget means the same thing on every deployment", () => {
    expect(utcDay(new Date("2026-08-24T23:59:59Z"))).toBe("2026-08-24");
    expect(utcDay(new Date("2026-08-25T00:00:00Z"))).toBe("2026-08-25");
  });

  it("retries a spent budget at the next UTC midnight", () => {
    expect(secondsUntilUtcMidnight(new Date("2026-08-24T23:59:00Z"))).toBe(60);
    expect(secondsUntilUtcMidnight(new Date("2026-08-24T00:00:00Z"))).toBe(86_400);
  });
});
