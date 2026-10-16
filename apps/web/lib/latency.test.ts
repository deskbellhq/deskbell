import { describe, expect, it } from "vitest";

import { formatLatency } from "./latency";

describe("formatLatency", () => {
  it("keeps milliseconds under a second and turns the rest into seconds", () => {
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(480.4)).toBe("480 ms");
    expect(formatLatency(999)).toBe("999 ms");
    expect(formatLatency(1000)).toBe("1 s");
    expect(formatLatency(1240)).toBe("1.2 s");
    expect(formatLatency(9960)).toBe("10 s");
    expect(formatLatency(13797)).toBe("14 s");
  });
  it("prints nothing for a value that is not a duration", () => {
    expect(formatLatency(-1)).toBe("");
    expect(formatLatency(Number.NaN)).toBe("");
  });
});
