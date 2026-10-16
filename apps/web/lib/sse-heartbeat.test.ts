import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_OPEN_COMMENT, SSE_PING_COMMENT, startHeartbeat } from "./sse-heartbeat";

describe("startHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the opening comment synchronously — headers must flush before the first event", () => {
    const writes: string[] = [];
    const hb = startHeartbeat((c) => writes.push(c), { intervalMs: 15_000 });
    expect(writes).toEqual([SSE_OPEN_COMMENT]);
    hb.stop();
  });

  it("pings after an interval of silence and stays quiet while real writes flow", () => {
    const writes: string[] = [];
    const hb = startHeartbeat((c) => writes.push(c), { intervalMs: 15_000 });
    vi.advanceTimersByTime(14_000);
    hb.touch(); // a token went out
    vi.advanceTimersByTime(14_000);
    expect(writes.filter((w) => w === SSE_PING_COMMENT)).toHaveLength(0);
    vi.advanceTimersByTime(6_000);
    expect(writes.filter((w) => w === SSE_PING_COMMENT)).toHaveLength(1);
    hb.stop();
  });

  it("keeps pinging through a long silence, once per interval", () => {
    const writes: string[] = [];
    const hb = startHeartbeat((c) => writes.push(c), { intervalMs: 15_000 });
    vi.advanceTimersByTime(60_000);
    const pings = writes.filter((w) => w === SSE_PING_COMMENT).length;
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(pings).toBeLessThanOrEqual(4);
    hb.stop();
  });

  it("stops itself when a write throws — the stream is gone and a timer has no caller", () => {
    let calls = 0;
    const hb = startHeartbeat(
      (c) => {
        if (c === SSE_PING_COMMENT) {
          calls++;
          throw new TypeError("Invalid state: Controller is already closed");
        }
      },
      { intervalMs: 15_000 },
    );
    expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
    expect(calls).toBe(1);
    hb.stop();
  });

  it("writes nothing after stop — a write after the stream closes would throw", () => {
    const writes: string[] = [];
    const hb = startHeartbeat((c) => writes.push(c), { intervalMs: 15_000 });
    hb.stop();
    vi.advanceTimersByTime(120_000);
    expect(writes).toEqual([SSE_OPEN_COMMENT]);
  });
});
