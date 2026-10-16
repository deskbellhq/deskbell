/**
 * Runs the gap-clustering catch-up for one project without pg-boss (spec:
 * gap-clusters) — the command-line twin of the hourly worker job, for an
 * operator who wants it now, or a fresh database that has never had a
 * worker attached.
 *
 * Assigns every gap-qualifying message without a cluster, oldest first, and
 * gives vectorless wordings their vector. Needs DATABASE_URL and the
 * embedding model configured, exactly like the worker.
 *
 * Usage:
 *   pnpm exec tsx --env-file-if-exists=.env scripts/cluster-gaps.ts --project proj_dev [--reset]
 *
 * --reset drops the project's clusters first (resolved state included) and
 * rebuilds from the rows — what the dashboard's re-cluster does.
 */
import { parseArgs } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { handleGapsCatchup } from "../apps/worker/src/handlers/gaps-catchup";
import { createEmbedder } from "../packages/core/src/models";
import { createDb, gapClusters, messages, projects } from "../packages/db/src";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    reset: { type: "boolean", default: false },
  },
});

if (!values.project) {
  console.error("usage: tsx scripts/cluster-gaps.ts --project <id> [--reset]");
  process.exit(2);
}

async function main() {
  const db = createDb();
  try {
    const [project] = await db
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, values.project as string))
      .limit(1);
    if (!project) throw new Error(`no project with id ${values.project}`);

    if (values.reset) {
      await db.transaction(async (tx) => {
        const owned = tx
          .select({ id: gapClusters.id })
          .from(gapClusters)
          .where(and(eq(gapClusters.orgId, project.orgId), eq(gapClusters.projectId, project.id)));
        await tx
          .update(messages)
          .set({ gapClusterId: null })
          .where(and(eq(messages.orgId, project.orgId), inArray(messages.gapClusterId, owned)));
        await tx
          .delete(gapClusters)
          .where(and(eq(gapClusters.orgId, project.orgId), eq(gapClusters.projectId, project.id)));
      });
      console.log(`reset: dropped every cluster in ${project.id}`);
    }

    const summary = await handleGapsCatchup(db, createEmbedder(), {
      orgId: project.orgId,
      projectId: project.id,
    });
    console.log(JSON.stringify(summary));
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
