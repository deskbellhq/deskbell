/**
 * Which context blocks the answer actually rested on (spec: grounded-generation).
 *
 * The model is asked to end its answer with a strict final line naming the
 * numbered blocks it used. That line is parsed off, never shown, and used to
 * pick the citations.
 *
 * WHY A TRAILING LINE RATHER THAN INLINE `[n]` MARKERS. Inline markers are the
 * obvious design and they are wrong for this corpus: stripping `[1]` from
 * streamed prose also strips `matrix[1]`, `argv[0]` and the label half of a
 * markdown link. Deskbell's whole subject matter is documentation, much of it
 * about code, so an inline stripper is a false-positive machine aimed squarely
 * at the content it is meant to serve. A single anchored line at the end is
 * parseable without touching a character of the answer.
 *
 * The cost is honest: per-claim provenance is lost. Nothing rendered it — the
 * widget shows one pill list per message — so nothing is lost today, and inline
 * markers can be layered on later behind a real renderer.
 *
 * WHY A BARE NUMBERS LINE IS ALSO RECOGNISED. Models drop the prefix: told the
 * line must hold nothing but numbers and commas, some write exactly that. A
 * bare `1, 8` under an answer is then streamed as prose and the citations fall
 * back to everything retrieved — the two visible failures this line exists to
 * prevent. The parser therefore reports the form it saw, and the engine trusts
 * the bare form only under guards it can check (prose precedes it, every number
 * is in range). Those guards are the caller's: this module has no idea how many
 * blocks there were.
 */

const SOURCES_PREFIX = "SOURCES:";

/**
 * Deliberately strict: digits and commas only. A documentation page that ends
 * with "SOURCES: see the appendix" fails this and is emitted as the prose it
 * is, rather than being swallowed as machine output.
 */
const SOURCES_LINE = /^SOURCES:[ \t]*((?:T?\d+[ \t]*,[ \t]*)*T?\d+)[ \t]*$/;

/** The prefix-less form: the numbers alone, nothing else on the line. */
const BARE_LINE = /^((?:\d+[ \t]*,[ \t]*)*\d+)$/;

/** Still on its way to being a bare numbers line — digits, commas and blanks only. */
const BARE_PREFIX = /^[\d, \t]*$/;

function isPrefixOfSources(text: string): boolean {
  return (
    SOURCES_PREFIX.startsWith(text) || text.startsWith(SOURCES_PREFIX) || BARE_PREFIX.test(text)
  );
}

export type SourcesForm = "prefixed" | "bare";

/**
 * Split streamed answer text into what is safe to send now and what must be
 * held back because it might turn out to be the sources line.
 *
 * Only the final line can be one, so everything up to the last newline is
 * always safe. This is why it is a separate mechanism from the refusal
 * sentinel's hold: that one is anchored to the START of the stream and releases
 * once the text proves not to be a sentinel, whereas this one is anchored to
 * the END and cannot resolve until the stream closes.
 */
export function splitSourcesTail(buffer: string): { emit: string; hold: string } {
  const newline = buffer.lastIndexOf("\n");
  if (newline === -1) {
    // No line break yet, so the whole buffer is still the final line.
    return isPrefixOfSources(buffer.trimStart())
      ? { emit: "", hold: buffer }
      : { emit: buffer, hold: "" };
  }
  const lastLine = buffer.slice(newline + 1);
  if (isPrefixOfSources(lastLine.trimStart())) {
    return { emit: buffer.slice(0, newline), hold: buffer.slice(newline) };
  }
  return { emit: buffer, hold: "" };
}

export interface ParsedSourcesTail {
  /** Block numbers named; null when the tail was not a sources line at all. */
  indices: number[] | null;
  /**
   * Tool results named as `T<n>` (spec: mcp-actions), 1-based in the order
   * the results arrived. Only the prefixed form may name them.
   */
  tools?: number[];
  /** Which shape the line took; absent when it was not a sources line. */
  form?: SourcesForm;
  text: string;
}

/**
 * Parse a held tail once the stream has closed.
 *
 * `indices` is null when the tail is not a sources line at all — the model
 * ignored the instruction, or the text merely started like one. `text` is what
 * still belongs in the answer, so a caller never silently drops prose.
 *
 * A `bare` result is an offer, not a verdict: the caller decides whether the
 * numbers are believable (see `isBareTailTrusted`) and falls back to treating
 * the tail as prose when they are not.
 */
export function parseSourcesTail(hold: string): ParsedSourcesTail {
  const trimmed = hold.trim();
  const prefixed = SOURCES_LINE.exec(trimmed);
  const bare = prefixed ? null : BARE_LINE.exec(trimmed);
  const match = prefixed ?? bare;
  if (!match?.[1]) return { indices: null, text: hold };
  const indices: number[] = [];
  const tools: number[] = [];
  for (const raw of match[1].split(",")) {
    const part = raw.trim();
    const isTool = part.startsWith("T");
    const n = Number.parseInt(isTool ? part.slice(1) : part, 10);
    if (!Number.isFinite(n)) continue;
    (isTool ? tools : indices).push(n);
  }
  // An empty list is a formatting slip, not a claim that nothing was used.
  // Treating it as "cited nothing" would put a real answer under no sources.
  if (indices.length === 0 && tools.length === 0) return { indices: null, text: hold };
  return {
    indices,
    ...(tools.length > 0 ? { tools } : {}),
    form: prefixed ? "prefixed" : "bare",
    text: "",
  };
}

/**
 * Whether a prefix-less numbers line can be taken as the sources line.
 *
 * Two guards, both cheap and both about not eating an answer. Some prose must
 * precede the line: the held tail starts with the newline that separated it, so
 * an answer that is nothing but "5" (no newline, no prose) is never swallowed.
 * And every number must name a block that exists: "The limit is\n5000" over
 * eight blocks is an answer, not a citation. A prefixed line needs neither —
 * the prefix is the model's explicit claim.
 */
export function isBareTailTrusted(
  hold: string,
  indices: readonly number[],
  blocks: number,
): boolean {
  if (!hold.startsWith("\n")) return false;
  return indices.every((n) => n >= 1 && n <= blocks);
}

/**
 * Pick the chunks the answer used, from 1-based block numbers.
 *
 * Out-of-range numbers are dropped rather than trusted — a model that invents
 * `[9]` over eight blocks must not be able to reach past the array. If nothing
 * survives, the caller falls back to the retrieved set: an answer under no
 * sources at all is a worse failure than an answer under too many.
 */
export function selectByIndex<T>(items: readonly T[], indices: readonly number[]): T[] {
  const seen = new Set<number>();
  const picked: T[] = [];
  for (const index of indices) {
    const zeroBased = index - 1;
    if (zeroBased < 0 || zeroBased >= items.length || seen.has(zeroBased)) continue;
    seen.add(zeroBased);
    const item = items[zeroBased];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}
