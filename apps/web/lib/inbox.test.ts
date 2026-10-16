import { describe, expect, it } from "vitest";

import { AVATAR_CLASSES, avatarClass, initialOf, relativeTime } from "./inbox";

describe("avatarClass", () => {
  it("is deterministic per session and always one of the pool", () => {
    expect(avatarClass("s-ben")).toBe(avatarClass("s-ben"));
    for (const seed of ["a", "s-ben", "conv_1", "e2e"]) {
      expect(AVATAR_CLASSES).toContain(avatarClass(seed));
    }
  });

  it("keeps the signal hues out of the decorative pool", () => {
    for (const cls of AVATAR_CLASSES) {
      expect(cls).not.toMatch(/amber|yellow|orange|red|rose|green|emerald|lime/);
    }
  });
});

describe("initialOf", () => {
  it("takes the first letter in any script and falls back to a question mark", () => {
    expect(initialOf("how do I…")).toBe("H");
    expect(initialOf("  ¿qué?")).toBe("Q");
    expect(initialOf("123")).toBe("?");
  });
});

describe("relativeTime", () => {
  it("reads now, minutes, hours and days", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now))).toBe("now");
    expect(relativeTime(new Date(now - 5 * 60_000))).toBe("5m");
    expect(relativeTime(new Date(now - 3 * 3_600_000))).toBe("3h");
    expect(relativeTime(new Date(now - 2 * 86_400_000))).toBe("2d");
  });
});
