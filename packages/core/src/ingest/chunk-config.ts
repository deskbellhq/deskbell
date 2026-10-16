import type { ChunkOptions } from "./chunker";

/**
 * Chunking settings from environment (spec: chunking-experiments).
 *
 *   DESKBELL_CHUNK_TARGET_CHARS   characters a chunk aims for (default 2800)
 *   DESKBELL_CHUNK_MAX_CHARS      hard cap before a block is split (default 3600)
 *   DESKBELL_CHUNK_OVERLAP_CHARS  tail of the previous chunk carried forward (default 350)
 *
 * Chunk size changes what every embedding is computed from, so it is a
 * retrieval-quality setting, not a tuning convenience: change it against
 * eval numbers, and re-sync the sources afterwards — chunks already stored
 * keep the size they were cut at. Same contract as the retrieval knobs:
 * parsed here so the name means one thing everywhere, the chunker itself
 * takes plain options and never reads the environment (D10), and a
 * malformed value warns and falls back rather than stopping ingestion.
 */
export function chunkOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ChunkOptions {
  const options: ChunkOptions = {};
  const knob = (name: string, raw: string | undefined, min: number): number | undefined => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      console.warn(`[chunking] ignoring ${name}="${raw}" — expected an integer >= ${min}`);
      return undefined;
    }
    return value;
  };
  const target = knob("DESKBELL_CHUNK_TARGET_CHARS", env.DESKBELL_CHUNK_TARGET_CHARS, 100);
  if (target !== undefined) options.targetChars = target;
  const max = knob("DESKBELL_CHUNK_MAX_CHARS", env.DESKBELL_CHUNK_MAX_CHARS, 100);
  if (max !== undefined) options.maxChars = max;
  const overlap = knob("DESKBELL_CHUNK_OVERLAP_CHARS", env.DESKBELL_CHUNK_OVERLAP_CHARS, 0);
  if (overlap !== undefined) options.overlapChars = overlap;

  // A cap below the target would split every chunk the packer just built.
  if (options.maxChars !== undefined && options.targetChars !== undefined) {
    if (options.maxChars < options.targetChars) {
      console.warn(
        `[chunking] DESKBELL_CHUNK_MAX_CHARS=${options.maxChars} is below the target ` +
          `${options.targetChars} — raising it to the target`,
      );
      options.maxChars = options.targetChars;
    }
  }
  return options;
}
