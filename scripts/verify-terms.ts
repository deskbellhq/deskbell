/**
 * Asks a project's corpus whether it contains the given names, the way the
 * answer-verification lookup does (spec: answer-verification). Read-only.
 * The one way to exercise the statement against a real database, since the
 * test suite has no database: run it on a hyphenated name, a plural where
 * the docs have the singular, a name with a diacritic, a possessive, a
 * symbol-only string, a string containing %, and a name that appears only
 * in a document title.
 *
 * Usage:
 *   DATABASE_URL=... pnpm verify-terms --project <id> "Find and Replace" "API keys" ...
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { lookupTerms, termVariants } from "../packages/core/src/index";
import { createDb, projects } from "../packages/db/src/index";

const { values, positionals } = parseArgs({
  options: { project: { type: "string" } },
  allowPositionals: true,
});

async function main() {
  if (!values.project || positionals.length === 0) {
    console.error('usage: pnpm verify-terms --project <id> "<name>" ["<name>" ...]');
    process.exit(2);
  }
  const db = createDb();
  try {
    const [project] = await db
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, values.project))
      .limit(1);
    if (!project) {
      console.error(`no project ${values.project}`);
      process.exit(2);
    }
    const found = await lookupTerms(db, project.orgId, project.id, positionals);
    for (const term of positionals) {
      const verdict = found.has(term) ? "found" : "NOT FOUND";
      console.log(`${verdict.padEnd(9)} ${term}  (${termVariants(term).join(" | ")})`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
