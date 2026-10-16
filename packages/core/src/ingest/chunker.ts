/**
 * Structure-aware chunker for ingested documents (spec: mvp-end-to-end).
 * Lives in core so the eval harness reuses the exact production chunking (D8).
 * Input is the connectors' pseudo-markdown: "#"-prefixed heading lines,
 * blank-line-separated blocks.
 */

export interface ChunkOptions {
  /** Soft chunk size to pack toward (~700 tokens at 4 chars/token). */
  targetChars?: number;
  /** Hard cap — oversized blocks are sentence-split under this. */
  maxChars?: number;
  /** Tail of the previous chunk repeated at the start of the next. */
  overlapChars?: number;
}

const DEFAULTS = { targetChars: 2800, maxChars: 3600, overlapChars: 350 };

function splitOversized(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const parts: string[] = [];
  let rest = block;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    else cut += 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function chunkText(content: string, opts: ChunkOptions = {}): string[] {
  const { targetChars, maxChars, overlapChars } = { ...DEFAULTS, ...opts };

  const blocks = content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  const trail: (string | undefined)[] = []; // heading trail by level, sparse on level jumps
  let current: string[] = [];
  let currentLen = 0;
  let currentTrail = "";
  let previousBody = "";

  const trailLabel = () => trail.filter(Boolean).join(" > ");

  const flush = () => {
    if (current.length === 0) return;
    const body = current.join("\n\n");
    // The heading-trail prefix keeps context when a section spans chunks.
    chunks.push(currentTrail && !body.startsWith("#") ? `${currentTrail}\n\n${body}` : body);
    previousBody = body;
    current = [];
    currentLen = 0;
  };

  for (const block of blocks) {
    const heading = /^(#{1,6})\s+(.+)/.exec(block);
    if (heading?.[1] && heading[2] && !block.includes("\n")) {
      const level = heading[1].length;
      trail.length = level - 1;
      trail[level - 1] = heading[2];
    }
    for (const piece of splitOversized(block, maxChars)) {
      if (currentLen > 0 && currentLen + piece.length > targetChars) {
        flush();
        currentTrail = trailLabel();
        if (overlapChars > 0 && previousBody) {
          const tail = previousBody.slice(-overlapChars);
          current.push(`…${tail}`);
          currentLen = tail.length;
        }
      }
      if (current.length === 0) currentTrail = trailLabel();
      current.push(piece);
      currentLen += piece.length + 2;
    }
  }
  flush();

  return chunks;
}
