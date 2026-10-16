import { describe, expect, it, vi } from "vitest";
import { chunkOptionsFromEnv } from "./chunk-config";

describe("chunkOptionsFromEnv", () => {
  it("returns no overrides when nothing is set — the chunker keeps its defaults", () => {
    expect(chunkOptionsFromEnv({})).toEqual({});
    expect(chunkOptionsFromEnv({ DESKBELL_CHUNK_TARGET_CHARS: " " })).toEqual({});
  });

  it("parses sizes an operator set deliberately", () => {
    expect(
      chunkOptionsFromEnv({
        DESKBELL_CHUNK_TARGET_CHARS: "1400",
        DESKBELL_CHUNK_MAX_CHARS: "1800",
        DESKBELL_CHUNK_OVERLAP_CHARS: "0",
      }),
    ).toEqual({ targetChars: 1400, maxChars: 1800, overlapChars: 0 });
  });

  it("ignores garbage one knob at a time rather than stopping ingestion", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      chunkOptionsFromEnv({
        DESKBELL_CHUNK_TARGET_CHARS: "big",
        DESKBELL_CHUNK_MAX_CHARS: "50",
        DESKBELL_CHUNK_OVERLAP_CHARS: "200",
      }),
    ).toEqual({ overlapChars: 200 });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("never lets the cap fall below the target", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      chunkOptionsFromEnv({
        DESKBELL_CHUNK_TARGET_CHARS: "2000",
        DESKBELL_CHUNK_MAX_CHARS: "1500",
      }),
    ).toEqual({ targetChars: 2000, maxChars: 2000 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
