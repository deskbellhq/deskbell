import { describe, expect, it } from "vitest";
import { clampToViewport, isDrag, toDockOffsets } from "./drag.ts";

describe("launcher drag geometry", () => {
  it("treats small pointer travel as a click", () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
    expect(isDrag({ x: 10, y: 10 }, { x: 10, y: 4 })).toBe(true);
  });

  it("keeps the launcher inside the viewport with a margin", () => {
    const size = { w: 48, h: 48 };
    const viewport = { w: 800, h: 600 };
    expect(clampToViewport({ x: -20, y: -20 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport({ x: 900, y: 700 }, size, viewport)).toEqual({ x: 744, y: 544 });
    expect(clampToViewport({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
  });

  it("never inverts the bounds on a viewport smaller than the launcher", () => {
    expect(clampToViewport({ x: 50, y: 50 }, { w: 400, h: 400 }, { w: 300, h: 300 })).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("converts a position into side and bottom offsets, panel below in the upper half", () => {
    const size = { w: 48, h: 48 };
    const viewport = { w: 800, h: 600 };
    expect(toDockOffsets({ x: 700, y: 500 }, size, viewport, "right")).toEqual({
      offsetX: 52,
      offsetY: 52,
      below: false,
    });
    expect(toDockOffsets({ x: 20, y: 40 }, size, viewport, "left")).toEqual({
      offsetX: 20,
      offsetY: 512,
      below: true,
    });
  });
});
