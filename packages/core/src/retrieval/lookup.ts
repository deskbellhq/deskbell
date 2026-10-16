import { chunks, type Database, documents, sources } from "@deskbell/db";
import { sql } from "drizzle-orm";
import { termVariants } from "../verify";

/** Anything that can run a statement: the database, or a transaction inside it. */
export type Executable = Pick<Database, "execute">;

/**
 * Which of the given names occur anywhere in a project's corpus (spec:
 * answer-verification). One statement over the chunk rows of record — the
 * rows both vector drivers share, like `hydrateChunks` — so the answer is
 * the same whichever index holds the vectors (D13).
 *
 * Two ways to be found, each scoped by organisation and project (D12): a
 * phrase query against the chunk search column, which uses the same text
 * search configuration the lexical leg does (lowercase, unaccented, no
 * stemming, stopwords kept, so "Find and Replace" is the three tokens in
 * order), a raw substring of a chunk's text for spellings the parser joins
 * into one token, or a substring of a document title normalized the way
 * the extractor normalizes names. Each name is tried in its plural and singular
 * variants; a hit on any variant finds the name. Documents are scoped
 * through their source, which is where the project lives.
 *
 * Returns the names found, as given. Throws on a database error: the engine
 * owns the fallback and leaves the answer unchecked.
 */
export async function lookupTerms(
  db: Executable,
  orgId: string,
  projectId: string,
  terms: string[],
): Promise<Set<string>> {
  const names: string[] = [];
  const variants: string[] = [];
  for (const term of terms) {
    for (const variant of termVariants(term)) {
      names.push(term);
      variants.push(variant);
    }
  }
  if (variants.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT DISTINCT t.term AS term
    FROM unnest(${sql.param(names)}::text[], ${sql.param(variants)}::text[]) AS t(term, variant)
    WHERE EXISTS (
      SELECT 1 FROM ${chunks} c
      WHERE c.org_id = ${orgId}
        AND c.project_id = ${projectId}
        AND c.search_tsv @@ phraseto_tsquery('deskbell_search', t.variant)
    ) OR EXISTS (
      -- The parser joins some spellings into one token ("14040/14044" is a
      -- file-like token, so "ISO 14044" is not the phrase iso ⟷ 14044). A raw
      -- substring pass over the project's chunks catches those; EXISTS stops
      -- at the first hit, so it costs a bounded scan only for names the
      -- phrase query missed.
      SELECT 1 FROM ${chunks} c
      WHERE c.org_id = ${orgId}
        AND c.project_id = ${projectId}
        AND unaccent(c.content) ILIKE '%' || t.variant || '%'
    ) OR EXISTS (
      SELECT 1 FROM ${documents} d
      JOIN ${sources} s ON s.id = d.source_id
      WHERE d.org_id = ${orgId}
        AND s.project_id = ${projectId}
        AND regexp_replace(unaccent(lower(d.title)), '[^[:alnum:]]+', ' ', 'g')
            LIKE '%' || t.variant || '%'
    )`);
  const rows = result.rows as unknown as Array<{ term: string }>;
  return new Set(rows.map((r) => r.term));
}
