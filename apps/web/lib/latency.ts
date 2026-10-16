/**
 * A duration for people: milliseconds under a second, seconds with one
 * decimal above it ("480 ms", "1.2 s", "14 s"). Thirteen thousand
 * milliseconds is a number to parse; thirteen seconds is a fact.
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  const text = s >= 10 ? s.toFixed(0) : s.toFixed(1).replace(/\.0$/, "");
  return `${text} s`;
}
