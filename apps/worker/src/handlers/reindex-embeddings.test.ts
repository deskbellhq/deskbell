import { EMBEDDING_DIMENSIONS } from "@deskbell/db";
import type { ReindexEmbeddingsJob } from "@deskbell/shared";
import { describe, expect, it } from "vitest";
import { EMBED_SLICE } from "./embed-chunks";
import { type ReindexDeps, runReindex } from "./reindex-embeddings";

const JOB: ReindexEmbeddingsJob = {
  orgId: "org_1",
  targetModel: "openai/text-embedding-3-small",
  targetVersion: 2,
};

interface Row {
  id: string;
  documentId: string;
  projectId: string;
  position: number | null;
  content: string;
  embeddingVersion: number;
}

function row(id: string, embeddingVersion: number): Row {
  return {
    id,
    documentId: `doc-${id}`,
    projectId: "proj_1",
    position: 0,
    content: `content of ${id}`,
    embeddingVersion,
  };
}

/**
 * In-memory stand-in implementing the same contract as the real deps: the
 * stale predicate is version-behind-target, and upsert is what advances a
 * row past it. Vectors are the right dimension unless the test says
 * otherwise.
 */
function fakeDeps(
  rows: Row[],
  opts: { dimensions?: number; job?: ReindexEmbeddingsJob } = {},
): ReindexDeps & { upserts: Parameters<ReindexDeps["upsert"]>[0][] } {
  const dimensions = opts.dimensions ?? EMBEDDING_DIMENSIONS;
  const target = (opts.job ?? JOB).targetVersion;
  const upserts: Parameters<ReindexDeps["upsert"]>[0][] = [];
  return {
    upserts,
    async loadStale(limit) {
      return rows
        .filter((r) => r.embeddingVersion < target)
        .slice(0, limit)
        .map(({ id, documentId, projectId, position, content }) => ({
          id,
          documentId,
          projectId,
          position,
          content,
        }));
    },
    async embedMany(values) {
      return values.map(() => new Array(dimensions).fill(0.1));
    },
    async upsert(items) {
      upserts.push(items);
      for (const item of items) {
        const found = rows.find((r) => r.id === item.chunkId);
        if (found) found.embeddingVersion = item.embeddingVersion;
      }
    },
  };
}

describe("runReindex", () => {
  it("re-embeds only rows behind the target, stamped with the new generation", async () => {
    // a1 is already at the target — a crashed earlier run got to it. It must
    // not be embedded again; that is the resumability contract.
    const rows = [row("a1", 2), row("b1", 1), row("b2", 1)];
    const result = await runReindex(fakeDeps(rows), JOB);

    expect(result.reembedded).toBe(2);
    expect(rows.every((r) => r.embeddingVersion === 2)).toBe(true);
  });

  it("carries the job's model and version on every row it writes", async () => {
    const deps = fakeDeps([row("b1", 1)]);
    await runReindex(deps, JOB);
    expect(deps.upserts.flat()).toMatchObject([
      { chunkId: "b1", embeddingModel: JOB.targetModel, embeddingVersion: JOB.targetVersion },
    ]);
  });

  it("works through the corpus in slices, not one giant batch", async () => {
    const rows = Array.from({ length: EMBED_SLICE + 5 }, (_, i) => row(`c${i}`, 1));
    const deps = fakeDeps(rows);
    await runReindex(deps, JOB);
    expect(deps.upserts.map((u) => u.length)).toEqual([EMBED_SLICE, 5]);
  });

  it("refuses a dimension change before touching any row", async () => {
    const rows = [row("b1", 1)];
    const deps = fakeDeps(rows, { dimensions: 768 });
    await expect(runReindex(deps, JOB)).rejects.toThrow(
      new RegExp(`768 dimensions.*vector\\(${EMBEDDING_DIMENSIONS}\\)`, "s"),
    );
    expect(deps.upserts).toHaveLength(0);
    expect(rows[0]?.embeddingVersion).toBe(1);
  });

  it("aborts loudly when the embedder stops producing, instead of spinning", async () => {
    // The probe succeeds — the model is fine — and then batches come back
    // empty. Without the guard the same rows reload forever.
    const deps = fakeDeps([row("b1", 1)]);
    const probe = deps.embedMany;
    let calls = 0;
    deps.embedMany = async (values) => (++calls === 1 ? probe(values) : []);
    await expect(runReindex(deps, JOB)).rejects.toThrow(/stalled/);
  });
});
