/**
 * A deterministic stand-in for a provider, so the fixture run needs no API key,
 * no network and no Postgres — and so CI gets the same numbers every time.
 *
 * It is not a language model. The embedder is lexical, and the generator is
 * extractive: it returns the sentences of the context that best match the
 * question, or the refusal sentinel when none match well enough. That is enough
 * for the fixture's job. Retrieval getting worse pushes the supporting
 * sentences out of context, factuality drops, and the gate goes red — which is
 * the behaviour a regression guard needs.
 */

/** Small enough to keep fixtures fast; large enough that terms rarely collide. */
const DIMENSIONS = 256;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
}

function hash(token: string): number {
  // FNV-1a: stable across processes and platforms, unlike anything seeded.
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIMENSIONS;
}

/** Term-frequency vector, L2-normalised so the dot product is a cosine. */
export function embedText(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const slot = hash(token);
    vector[slot] = (vector[slot] ?? 0) + 1;
  }

  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * Function words, removed before scoring overlap. Without this every sentence
 * scores on "the" and "your" and the stub answers anything — which would make
 * the uncertainty half of the fixture meaningless.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "you",
  "your",
  "with",
  "that",
  "this",
  "from",
  "into",
  "has",
  "have",
  "its",
  "was",
  "were",
  "will",
  "would",
  "can",
  "could",
  "does",
  "did",
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "but",
  "not",
  "all",
  "any",
  "there",
  "their",
  "then",
  "than",
  "them",
  "they",
  "been",
  "being",
  "about",
  "also",
  "some",
  "such",
  "only",
  "other",
  "must",
  "may",
  "might",
  "should",
  "need",
  "want",
  "each",
  "one",
  "two",
  "per",
]);

function contentTerms(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

function overlapScore(question: string[], sentence: string): number {
  const terms = new Set(contentTerms(sentence));
  if (terms.size === 0 || question.length === 0) return 0;
  const hits = question.filter((q) => terms.has(q)).length;
  // Share of the question's terms the sentence covers. Asymmetric on purpose:
  // a long sentence answering the whole question should not be penalised for
  // also saying other things.
  return hits / question.length;
}

/** Below this, the context does not answer the question and the stub refuses. */
export const STUB_ANSWER_THRESHOLD = 0.34;

/** How many supporting sentences the stub will quote. */
const MAX_SENTENCES = 3;

/** The engine numbers each context block `[n]` and separates blocks with a rule. */
function splitBlocks(context: string): Array<{ index: number; text: string }> {
  return context.split("\n\n---\n\n").map((block, position) => {
    const marker = /^\[(\d+)\]\s*/.exec(block);
    return {
      index: marker?.[1] ? Number.parseInt(marker[1], 10) : position + 1,
      text: marker ? block.slice(marker[0].length) : block,
    };
  });
}

export function generateFromContext(context: string, message: string, sentinel: string): string {
  const question = [...new Set(contentTerms(message))];

  const scored = splitBlocks(context)
    .flatMap(({ index, text }) =>
      splitSentences(text)
        // Keep only real sentences. Chunk titles and the chunker's heading trail
        // ("A > B > C") carry no statement and would otherwise be quoted as answers.
        .filter((s) => /[.!?]$/.test(s))
        .map((sentence) => ({ sentence, index, score: overlapScore(question, sentence) })),
    )
    .filter((s) => s.score >= STUB_ANSWER_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.sentence.localeCompare(b.sentence));

  if (scored.length === 0) return sentinel;

  // Chunks overlap, so the same sentence arrives more than once. Quoting it
  // twice is noise, and worse, it moves answer length around for no reason.
  const seen = new Set<string>();
  const picked: string[] = [];
  const blocks = new Set<number>();
  for (const { sentence, index } of scored) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(sentence);
    blocks.add(index);
    if (picked.length === MAX_SENTENCES) break;
  }

  // The sources line the engine parses citations from (spec:
  // grounded-generation). An extractive generator knows exactly which block it
  // quoted, so this is ground truth rather than a judgement — which is why the
  // citation numbers below measure the plumbing, not a model's willingness to
  // cite honestly. That needs a real target.
  const sources = [...blocks].sort((a, b) => a - b).join(", ");
  return `${picked.join(" ")}\nSOURCES: ${sources}`;
}
