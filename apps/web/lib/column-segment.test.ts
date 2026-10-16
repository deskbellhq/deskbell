import { describe, expect, it } from "vitest";

import { segmentPath } from "./column-segment";

const box = { x: 10, y: 20, width: 12, height: 40 };

describe("segmentPath", () => {
  it("rounds the top of a topmost segment", () => {
    expect(segmentPath(box, { topmost: true, trim: 0, radius: 4 })).toBe(
      "M10,60 V24 Q10,20 14,20 H18 Q22,20 22,24 V60 Z",
    );
  });

  it("keeps a lower segment square", () => {
    expect(segmentPath(box, { topmost: false, trim: 0, radius: 4 })).toBe("M10,60 V20 H22 V60 Z");
  });

  it("trims the foot of an upper segment for the surface gap", () => {
    // Same top edge, two pixels shorter: the gap is at the boundary below.
    expect(segmentPath(box, { topmost: true, trim: 2, radius: 4 })).toBe(
      "M10,58 V24 Q10,20 14,20 H18 Q22,20 22,24 V58 Z",
    );
  });

  it("caps the radius by the segment's own size", () => {
    expect(segmentPath({ ...box, height: 2 }, { topmost: true, trim: 0, radius: 4 })).toBe(
      "M10,22 V22 Q10,20 12,20 H20 Q22,20 22,22 V22 Z",
    );
    expect(segmentPath({ ...box, width: 4 }, { topmost: true, trim: 0, radius: 4 })).toBe(
      "M10,60 V22 Q10,20 12,20 H12 Q14,20 14,22 V60 Z",
    );
  });

  it("draws nothing when the trim eats the whole segment", () => {
    expect(segmentPath({ ...box, height: 2 }, { topmost: true, trim: 2, radius: 4 })).toBeNull();
    expect(segmentPath({ ...box, height: 0 }, { topmost: false, trim: 0, radius: 4 })).toBeNull();
  });
});
