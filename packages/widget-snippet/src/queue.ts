/** One buffered `deskbell(name, arg, extra)` call. */
export type DeskbellCall = [string, unknown?, unknown?];

/** The pre-ready stub is a *function* that carries its queue on `.q`. */
export type DeskbellStub = ((name: string, arg?: unknown, extra?: unknown) => void) & {
  q?: DeskbellCall[];
};

/**
 * Read the pre-ready queue off `window.deskbell`.
 *
 * A `typeof === "function"` test cannot decide whether anything was queued —
 * it matches the stub and the live dispatcher alike, and getting this wrong
 * drops every pre-ready call in silence. Kept in its own DOM-free module so it
 * stays under test; ./index.ts touches `document` at module scope.
 */
export function readQueue(value: unknown): DeskbellCall[] {
  const queue = (value as DeskbellStub | undefined)?.q;
  return Array.isArray(queue) ? [...queue] : [];
}
