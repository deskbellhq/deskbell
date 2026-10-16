/**
 * Re-embeds one project's chunks from the command line (spec:
 * chunking-experiments).
 *
 * Runs the worker's resumable re-index loop directly against DATABASE_URL —
 * the same code the reindex.embeddings job runs, without pg-boss. For an
 * operator that means re-embedding after changing the embedding model or
 * what the embedding is computed from, without the dashboard; for a tuning
 * run it means re-embedding a cloned corpus and measuring it.
 *
 * Every chunk whose embedding_version is behind the target is re-embedded
 * and stamped with the target; a second run finds nothing to do. Nothing
 * else in the row changes.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx --env-file-if-exists=.env scripts/reindex-project.ts \
 *     --project proj_dev [--target-version 2] [--model openai/text-embedding-3-small]
 */
import { parseArgs } from "node:util";
import {
  createReindexDeps,
  planProjectReindex,
  runReindex,
} from "../apps/worker/src/handlers/reindex-embeddings";
import { createVectorStore } from "../packages/core/src/index";
import { createDb } from "../packages/db/src/index";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    "target-version": { type: "string" },
    model: { type: "string" },
  },
});

if (!values.project) {
  console.error(
    "usage: tsx scripts/reindex-project.ts --project <id> [--target-version <n>] [--model <provider/model>]",
  );
  process.exit(2);
}
const projectId = values.project;

const targetVersion =
  values["target-version"] === undefined ? undefined : Number(values["target-version"]);
if (targetVersion !== undefined && (!Number.isInteger(targetVersion) || targetVersion < 1)) {
  console.error(`--target-version must be a positive integer, got "${values["target-version"]}"`);
  process.exit(2);
}

async function main() {
  const db = createDb();
  try {
    // Without --model the configured embedding model is used, resolved where
    // every other embedder is (the model-config module reads the env).
    const job = await planProjectReindex(db, projectId, {
      targetVersion,
      targetModel: values.model,
    });
    console.error(
      `re-embedding project ${job.projectId} (org ${job.orgId}) → ${job.targetModel} v${job.targetVersion}`,
    );
    const { reembedded } = await runReindex(createReindexDeps(db, createVectorStore(db), job), job);
    console.error(`${reembedded} chunks re-embedded`);
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
