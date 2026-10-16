/**
 * Cap on simultaneous answer streams per caller (spec: widget-abuse-protection).
 *
 * In-process on purpose. A stream is held open by one Node process, so that
 * process is where the count actually lives — a database row would need a write
 * on open, a write on close, and a reaper for the closes that never happen.
 * Across replicas this is per-instance; the per-IP rate limit is what holds
 * globally. Documented in apps/docs/content/docs/manage/security.mdx.
 */

const inFlight = new Map<string, number>();

export interface Slot {
  release(): void;
}

/** Take a slot, or null when the caller is already at the limit. Always release in a finally. */
export function acquireSlot(subject: string, max: number): Slot | null {
  if (max <= 0) return { release() {} };
  const current = inFlight.get(subject) ?? 0;
  if (current >= max) return null;
  inFlight.set(subject, current + 1);

  let released = false;
  return {
    release() {
      if (released) return; // a double release would let one caller mint slots
      released = true;
      const next = (inFlight.get(subject) ?? 1) - 1;
      if (next <= 0) inFlight.delete(subject);
      else inFlight.set(subject, next);
    },
  };
}

/** Test seam — the map is module state, and tests must not leak into each other. */
export function resetSlots(): void {
  inFlight.clear();
}
