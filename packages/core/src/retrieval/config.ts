import type { RetrievalOptions } from "../engine";

/**
 * Retrieval settings from environment (spec: grounded-generation,
 * hybrid-retrieval §3).
 *
 *   DESKBELL_RETRIEVAL_MIN_SCORE    cosine-similarity floor, 0 (off) to 1
 *   DESKBELL_RETRIEVAL_MODE         vector (default) | hybrid
 *   DESKBELL_RETRIEVAL_MULTI_QUERY  off (default) | on
 *   DESKBELL_RETRIEVAL_LEG_DEPTH    per-leg candidate depth (default 50)
 *   DESKBELL_RETRIEVAL_EF_SEARCH    ANN scan depth, pgvector hnsw.ef_search (default 100)
 *   DESKBELL_RETRIEVAL_POOL         pooled-candidate count (default 24)
 *   DESKBELL_RETRIEVAL_MAX_PER_DOC  chunks per document at final selection (default 1), 0 = off
 *   DESKBELL_RETRIEVAL_ORDER        fused (default) | cosine
 *
 * The sizing knobs are a LATENCY BUDGET, not a quality dial — turning them up
 * buys latency and tokens first. The floor decides whether the visitor gets
 * an answer at all: zero hits above it refuses before the model is consulted,
 * and correct documents routinely score poorly. Everything ranking-affecting
 * defaults to today's behaviour; change it only against eval numbers (D8).
 *
 * Env parsing lives here rather than in the host apps so each knob has one
 * name and one meaning everywhere the engine runs; the engine itself still
 * takes plain options and never reads the environment (D10). Malformed values
 * warn and fall back to the default — an env typo may cost quality, never
 * availability.
 */
export function retrievalOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RetrievalOptions {
  const options: RetrievalOptions = {};

  const rawMinScore = env.DESKBELL_RETRIEVAL_MIN_SCORE;
  if (rawMinScore !== undefined && rawMinScore.trim() !== "") {
    const minScore = Number(rawMinScore);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore >= 1) {
      console.warn(
        `[retrieval] ignoring DESKBELL_RETRIEVAL_MIN_SCORE="${rawMinScore}" — expected a number in [0, 1)`,
      );
    } else {
      options.minScore = minScore;
    }
  }

  const mode = env.DESKBELL_RETRIEVAL_MODE?.trim().toLowerCase();
  if (mode === "vector" || mode === "hybrid") {
    options.mode = mode;
  } else if (mode) {
    console.warn(`[retrieval] ignoring DESKBELL_RETRIEVAL_MODE="${mode}" — vector | hybrid`);
  }

  const multi = env.DESKBELL_RETRIEVAL_MULTI_QUERY?.trim().toLowerCase();
  if (multi === "on" || multi === "off") {
    options.multiQuery = multi === "on";
  } else if (multi) {
    console.warn(`[retrieval] ignoring DESKBELL_RETRIEVAL_MULTI_QUERY="${multi}" — on | off`);
  }

  const intKnob = (name: string, raw: string | undefined, min: number): number | undefined => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      console.warn(`[retrieval] ignoring ${name}="${raw}" — expected an integer >= ${min}`);
      return undefined;
    }
    return value;
  };
  const legDepth = intKnob("DESKBELL_RETRIEVAL_LEG_DEPTH", env.DESKBELL_RETRIEVAL_LEG_DEPTH, 1);
  if (legDepth !== undefined) options.legDepth = legDepth;
  const efSearch = intKnob("DESKBELL_RETRIEVAL_EF_SEARCH", env.DESKBELL_RETRIEVAL_EF_SEARCH, 1);
  if (efSearch !== undefined) options.efSearch = efSearch;
  const pool = intKnob("DESKBELL_RETRIEVAL_POOL", env.DESKBELL_RETRIEVAL_POOL, 1);
  if (pool !== undefined) options.pool = pool;
  const maxPerDoc = intKnob(
    "DESKBELL_RETRIEVAL_MAX_PER_DOC",
    env.DESKBELL_RETRIEVAL_MAX_PER_DOC,
    0,
  );
  if (maxPerDoc !== undefined) options.maxPerDocument = maxPerDoc;

  const order = env.DESKBELL_RETRIEVAL_ORDER?.trim().toLowerCase();
  if (order === "fused" || order === "cosine") {
    options.order = order;
  } else if (order) {
    console.warn(`[retrieval] ignoring DESKBELL_RETRIEVAL_ORDER="${order}" — fused | cosine`);
  }

  return options;
}
