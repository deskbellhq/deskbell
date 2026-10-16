/**
 * Geometry for the draggable launcher (spec: widget-launcher-drag). Pure, so
 * it is unit-tested without a DOM; the panel wires pointer events to it.
 */

/** Pointer travel below this is a click, not a drag. */
export const DRAG_THRESHOLD = 4;
/** The launcher never leaves the viewport by more than this margin allows. */
export const VIEWPORT_MARGIN = 8;

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

export function isDrag(start: Point, now: Point): boolean {
  return Math.max(Math.abs(now.x - start.x), Math.abs(now.y - start.y)) >= DRAG_THRESHOLD;
}

/** Keep a box of `size` at `pos` (top-left) inside the viewport, margin included. */
export function clampToViewport(pos: Point, size: Size, viewport: Size): Point {
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.w - size.w - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.h - size.h - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, pos.x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, pos.y), maxY),
  };
}

export interface DockOffsets {
  /** Distance from the anchored side (left or right), in px. */
  offsetX: number;
  /** Distance from the bottom, in px. */
  offsetY: number;
  /** True when the launcher sits in the upper half: the panel opens below it. */
  below: boolean;
}

/**
 * Translate a top-left position into the dock's offset tokens. The dock is
 * anchored to the bottom and one side, so the panel follows the launcher
 * through the same two custom properties it always read.
 */
export function toDockOffsets(
  pos: Point,
  size: Size,
  viewport: Size,
  side: "left" | "right",
): DockOffsets {
  const offsetX = side === "right" ? viewport.w - (pos.x + size.w) : pos.x;
  const offsetY = viewport.h - (pos.y + size.h);
  return {
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
    below: pos.y + size.h / 2 < viewport.h / 2,
  };
}
