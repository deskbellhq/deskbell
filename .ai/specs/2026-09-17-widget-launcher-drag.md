# Draggable launcher

> Status: done · 2026-09-17

**Goal.** A fixed launcher covers something on some pages: a cookie banner, a
chat from another vendor, a form's submit button. Letting the visitor move it
is cheaper than a per-page offset and fixes the case nobody configured for.

## Design

**Off by default**, `launcher-draggable` turns it on. Pointer events on the
dock (so a slotted custom launcher drags too): a press records the origin,
movement under four pixels stays a click, beyond it the launcher follows the
pointer, clamped to the viewport with an eight-pixel margin. Pointer capture
keeps the drag alive when the pointer outruns the button. The click that ends a
drag does not toggle the panel.

**The panel follows through the tokens it already reads.** The new position is
written as `--_cfg-launcher-offset-x/y`, one layer above the configured
offsets and still below host CSS, so the panel's own `bottom` and `right`
follow without knowing a drag happened. Dragged into the upper half of the
viewport, the panel opens below the launcher instead of above it, sized to the
room that leaves.

**Nothing is remembered.** A reload puts the launcher back where the
configuration says. Persisting the position would mean the operator's Appearance
change never shows to a visitor who once moved it.

Geometry lives in `drag.ts` with no DOM, under unit test; the panel wires
events to it. Inline mode has no launcher and ignores the option.

## Non-goals

- Snapping to corners. Free placement is the feature.
- Keyboard-driven moves. The option is for pointer users; the keyboard path
  is the configured position.

## Verify

- Threshold, clamping and offset conversion under test.
- Manual: drag to each edge, panel opens on the correct side, a click after a
  drag does not open, resize re-clamps, position resets on reload.
