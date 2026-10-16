/**
 * Checks a Weaviate collection against the chunk rows in Postgres and
 * removes what should not be there (spec: vector-store-single-home).
 *
 * The row is the record of where a chunk's vector lives; the collection is
 * the vector. Two things can drift: an object whose row is gone (a delete
 * that failed) — pruned here — and a row marked as indexed here whose
 * object is missing (a Weaviate restore from an older backup) — reported
 * here and repaired by Re-embed on the Sources page, which this script
 * says. Idempotent, and it never writes to Postgres.
 *
 * Usage:
 *   DESKBELL_VECTOR_STORE=weaviate WEAVIATE_URL=... DATABASE_URL=... \
 *     pnpm vector-store:prune [--org <id>] [--dry-run]
 */
import { parseArgs } from "node:util";
import { asc, eq } from "drizzle-orm";
import {
  deleteFromWeaviate,
  listWeaviateChunks,
  vectorStoreConfigFromEnv,
  vectorStoreId,
} from "../packages/core/src/index";
import { chunks, createDb } from "../packages/db/src/index";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  const config = vectorStoreConfigFromEnv();
  if (config.driver !== "weaviate") {
    console.error("DESKBELL_VECTOR_STORE must be weaviate — pgvector's index is the chunks table");
    process.exit(2);
  }
  const weaviate = config.weaviate;
  const storeId = vectorStoreId(config);
  const dryRun = values["dry-run"] ?? false;
  const db = createDb();
  try {
    const orgs = values.org
      ? [values.org]
      : (
          await db.selectDistinct({ orgId: chunks.orgId }).from(chunks).orderBy(asc(chunks.orgId))
        ).map((r) => r.orgId);
    const wanted = new Set(orgs);

    // One walk over the collection (the cursor API takes no filter), grouped
    // by org; each org's objects are checked against its rows.
    const objectsByOrg = new Map<string, Set<string>>();
    for await (const page of listWeaviateChunks(weaviate)) {
      for (const { chunkId, orgId } of page) {
        if (!wanted.has(orgId)) continue;
        const set = objectsByOrg.get(orgId) ?? new Set<string>();
        set.add(chunkId);
        objectsByOrg.set(orgId, set);
      }
    }

    for (const orgId of orgs) {
      const rows = await db
        .select({ id: chunks.id, store: chunks.vectorStore })
        .from(chunks)
        .where(eq(chunks.orgId, orgId));
      const objects = objectsByOrg.get(orgId) ?? new Set<string>();
      const known = new Set(rows.map((r) => r.id));
      const markedHere = rows.filter((r) => r.store === storeId).map((r) => r.id);

      const stale = [...objects].filter((id) => !known.has(id));
      const missing = markedHere.filter((id) => !objects.has(id));

      if (!dryRun) await deleteFromWeaviate(weaviate, orgId, stale);
      console.error(
        `[${orgId}] rows marked ${storeId}: ${markedHere.length} · objects: ${objects.size} · ` +
          `pruned ${stale.length} stale objects${dryRun ? " (dry run)" : ""}`,
      );
      if (missing.length > 0) {
        console.error(
          `[${orgId}] ${missing.length} rows are marked as indexed here but have no object — ` +
            "the collection is behind the rows; Re-embed on the Sources page repairs it",
        );
      }
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
