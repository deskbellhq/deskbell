/**
 * Answer verification (spec: answer-verification): the names an answer
 * asserts — bold spans and inline code — must exist in the material the
 * answer drew on or somewhere in the corpus. Pure text functions; the engine
 * supplies the texts and the corpus lookup, so nothing here knows where
 * either comes from (D10).
 */

/** What the check found. `checked` is what was tested, `unsupported` ⊆ `checked`. */
export interface VerificationReport {
  checked: string[];
  unsupported: string[];
}

/** At most this many names are checked per answer; the rest are ignored. */
export const MAX_TERMS = 12;

/** How long the corpus lookup may take before the answer is left unchecked. */
export const LOOKUP_TIMEOUT_MS = 2000;

/** Bold labels that name nothing: a heading word, not a product name. */
const LABEL_WORDS = new Set([
  "note",
  "notes",
  "tip",
  "tips",
  "yes",
  "no",
  "important",
  "example",
  "examples",
  "warning",
  "step",
  "steps",
  "optional",
  "required",
]);

/**
 * The index's notion of a token. The search column is built with a text
 * search configuration that lowercases, strips accents, keeps stopwords and
 * does not stem; this does the same so a name the extractor considers
 * supported is one the phrase query would find too. A trailing possessive
 * is dropped ("Deskbell's" → "deskbell") because the docs name the thing,
 * not what belongs to it.
 */
export function normalizeTerm(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/['’]s(?=[^\p{L}\p{N}]|$)/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The forms a name is searched in. No stemming anywhere, so plural against
 * singular is the largest source of false alarms; checking both costs one
 * more phrase per name and removes it.
 */
export function termVariants(term: string): string[] {
  const base = normalizeTerm(term);
  if (base === "") return [];
  const variants = [base];
  if (base.endsWith("s") && base.length > 3) variants.push(base.slice(0, -1));
  else variants.push(`${base}s`);
  return variants;
}

/** Word-bounded containment on normalized text, so "key" does not match "keyboard". */
function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Whether any variant of the name occurs, word-bounded, in any of the texts.
 * Texts are normalized here; callers with many names normalize once with
 * `normalizeTerm` and use `isSupportedByNormalized`.
 */
export function isSupportedBy(term: string, texts: string[]): boolean {
  return isSupportedByNormalized(
    term,
    texts.map((t) => normalizeTerm(t)),
  );
}

export function isSupportedByNormalized(term: string, normalizedTexts: string[]): boolean {
  const variants = termVariants(term);
  return variants.some((v) => normalizedTexts.some((t) => containsPhrase(t, v)));
}

const FENCED = /(```|~~~)[\s\S]*?(\1|$)/g;
const BOLD_STARS = /\*\*([^*\n]+?)\*\*/g;
const BOLD_UNDERSCORES = /(?<![\p{L}\p{N}_])__([^_\n]+?)__(?![\p{L}\p{N}_])/gu;
const INLINE_CODE = /`([^`\n]+?)`/g;
const PATH_SEPARATORS = /\s*(?:→|›|»|->|>)\s*/;

/** Looks like a URL, an address or a file path: never a product name. */
function isLocator(candidate: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return true;
  if (candidate.includes("@")) return true;
  if (candidate.includes("/") && candidate.includes(".")) return true;
  return false;
}

/**
 * A bold span that ends in a colon labels what follows ("**Open the
 * attribute:** select Edit"): a heading the model wrote, not a name it
 * asserts. A name used as a label keeps the colon outside the bold and is
 * still checked.
 */
function isHeading(raw: string): boolean {
  return raw.trim().endsWith(":");
}

/** Trims decoration and decides whether the span is a name worth checking. */
function candidateOf(raw: string, opts: { code: boolean }): string | null {
  const candidate = raw.trim().replace(/\.+$/u, "").trim();
  if (candidate.length < 3 || candidate.length > 80) return null;
  if (!/\p{L}/u.test(candidate)) return null;
  if (opts.code && (/\s/.test(candidate) || candidate.length > 40)) return null;
  if (candidate.split(/\s+/).length > 8) return null;
  if (isLocator(candidate)) return null;
  // Sentence punctuation inside a span means it is prose the model emphasised.
  if (/[.!?]\s|[?!]$/.test(candidate)) return null;
  const normalized = normalizeTerm(candidate);
  if (normalized.length < 3 || LABEL_WORDS.has(normalized)) return null;
  return candidate;
}

/**
 * The names an answer asserts: bold spans and single-token inline code, in
 * first-seen order, deduplicated by normalized form, at most `MAX_TERMS`.
 * Fenced code is skipped — it holds commands and samples, not claims. A path
 * written with arrows ("Settings → Billing") contributes the whole and each
 * part, since the docs may write only the parts.
 */
export function extractTerms(answer: string): string[] {
  const text = answer.replace(FENCED, " ");
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string, opts: { code: boolean }) => {
    const candidate = candidateOf(raw, opts);
    if (!candidate) return;
    const key = normalizeTerm(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(candidate);
  };
  const addWithParts = (raw: string, opts: { code: boolean }) => {
    if (isHeading(raw)) return;
    add(raw, opts);
    if (!opts.code && PATH_SEPARATORS.test(raw)) {
      for (const part of raw.split(PATH_SEPARATORS)) add(part, opts);
    }
  };
  for (const match of text.matchAll(BOLD_STARS)) addWithParts(match[1] ?? "", { code: false });
  for (const match of text.matchAll(BOLD_UNDERSCORES))
    addWithParts(match[1] ?? "", { code: false });
  for (const match of text.matchAll(INLINE_CODE)) add(match[1] ?? "", { code: true });
  return found.slice(0, MAX_TERMS);
}

export interface VerifyInput {
  /** The answer as the visitor will read it, markdown included. */
  answer: string;
  /** What the visitor typed — this message and prior turns. A name here was not invented. */
  said?: string[];
  /** Names the project asked never to flag. */
  ignoredTerms?: string[];
  /** The material the answer was allowed to draw on: retrieved blocks, tool results. */
  support: string[];
  /**
   * Finds which of the given names occur anywhere in the corpus. Absent means
   * the local pass is the whole check. May reject; a rejection or a timeout
   * leaves the answer unchecked rather than wrongly flagged.
   */
  lookup?: (terms: string[]) => Promise<Set<string>>;
  lookupTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lookup exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The check. Null means "could not be checked" — the lookup failed — and is
 * distinct from a report with nothing unsupported; nothing downstream may
 * collapse the two (spec: answer-verification).
 */
export async function verifyAnswer(input: VerifyInput): Promise<VerificationReport | null> {
  const said = (input.said ?? []).map((t) => normalizeTerm(t));
  const ignored = new Set((input.ignoredTerms ?? []).map((t) => normalizeTerm(t)));
  const checked = extractTerms(input.answer).filter(
    (term) => !ignored.has(normalizeTerm(term)) && !isSupportedByNormalized(term, said),
  );
  const support = input.support.map((t) => normalizeTerm(t));
  const local = checked.filter((term) => !isSupportedByNormalized(term, support));
  if (local.length === 0 || !input.lookup) return { checked, unsupported: local };
  try {
    const found = await withTimeout(
      input.lookup(local),
      input.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS,
    );
    return { checked, unsupported: local.filter((term) => !found.has(term)) };
  } catch (error) {
    console.error("[engine] term lookup failed, answer left unchecked:", error);
    return null;
  }
}
