/**
 * The outline of one segment of a stacked column (components/answers-chart).
 * The topmost segment gets a rounded top; an upper segment gives up a few
 * pixels at its foot so the surface separates it from the one below — a
 * stroke around each segment would thin the column instead.
 */
export interface SegmentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentShape {
  /** Nothing sits above this segment, so it carries the rounded top. */
  topmost: boolean;
  /** Pixels removed from the foot: the surface gap to the segment below. */
  trim: number;
  /** The corner radius of a topmost segment, before it is capped by size. */
  radius: number;
}

/** SVG path data, or null when nothing would be visible. */
export function segmentPath(box: SegmentBox, shape: SegmentShape): string | null {
  const { x, y, width } = box;
  const height = box.height - shape.trim;
  if (height <= 0 || width <= 0) return null;
  const r = shape.topmost ? Math.min(shape.radius, width / 2, height) : 0;
  const right = x + width;
  const bottom = y + height;
  const parts = [`M${x},${bottom}`, `V${y + r}`];
  if (r > 0) parts.push(`Q${x},${y} ${x + r},${y}`);
  parts.push(`H${right - r}`);
  if (r > 0) parts.push(`Q${right},${y} ${right},${y + r}`);
  parts.push(`V${bottom}`, "Z");
  return parts.join(" ");
}
