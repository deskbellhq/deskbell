import { describe, expect, it } from "vitest";
import type { AssignResult } from "./assign-gap-cluster";
import { type CatchupDeps, runCatchup } from "./gaps-catchup";

interface Row {
  messageId: string;
  question: string;
  scope: string;
  clusterId: string | null;
}

/** Unassigned rows drain as they are assigned; vectorless wordings heal when the embedder works. */
function fake(
  rows: Row[],
  opts: { embedderDown?: boolean; vectorless?: string[]; ignoredTerms?: string[] } = {},
) {
  const calls: { embedded: string[][]; assigned: Array<[string, boolean]>; healed: string[] } = {
    embedded: [],
    assigned: [],
    healed: [],
  };
  let vectorless = [...(opts.vectorless ?? [])];
  const deps: CatchupDeps = {
    async listProjects() {
      return [...new Set(rows.map((r) => r.scope))].map((s) => ({ orgId: "org", projectId: s }));
    },
    async ignoredTerms() {
      return opts.ignoredTerms ?? [];
    },
    async loadUnassigned(scope, limit) {
      return rows
        .filter((r) => r.scope === scope.projectId && r.clusterId === null)
        .slice(0, limit);
    },
    async embedMany(values) {
      calls.embedded.push(values);
      return values.map((v) => (opts.embedderDown ? null : [v.length]));
    },
    async assign(_scope, messageId, embedding): Promise<AssignResult | null> {
      const row = rows.find((r) => r.messageId === messageId);
      if (!row) return null;
      row.clusterId = `gap_${messageId}`;
      calls.assigned.push([messageId, embedding !== null]);
      return {
        clusterId: row.clusterId,
        joinedBy: "created",
        reopened: false,
        analysisRequested: false,
      };
    },
    async loadVectorless(_scope, limit) {
      return vectorless
        .slice(0, limit)
        .map((id) => ({ id, clusterId: `gap_${id}`, text: `text ${id}` }));
    },
    async setPhrasingVector(_scope, phrasing) {
      vectorless = vectorless.filter((id) => id !== phrasing.id);
      calls.healed.push(phrasing.id);
    },
  };
  return { deps, calls };
}

const row = (id: string, scope = "p1"): Row => ({
  messageId: id,
  question: `q ${id}`,
  scope,
  clusterId: null,
});

describe("runCatchup", () => {
  it("assigns every unassigned row in slices, one embedding batch per slice, oldest first", async () => {
    const { deps, calls } = fake([row("a"), row("b"), row("c")]);
    const summary = await runCatchup(deps, {}, 2);

    expect(summary).toEqual({ projects: 1, assigned: 3, created: 3, healed: 0 });
    expect(calls.embedded).toEqual([["q a", "q b"], ["q c"]]);
    expect(calls.assigned.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("scopes to the project named in the job", async () => {
    const { deps, calls } = fake([row("a", "p1"), row("b", "p2")]);
    const summary = await runCatchup(deps, { orgId: "org", projectId: "p2" }, 10);

    expect(summary.projects).toBe(1);
    expect(calls.assigned.map(([id]) => id)).toEqual(["b"]);
  });

  it("carries on by key when the embedder is down, and heals nothing", async () => {
    const { deps, calls } = fake([row("a")], { embedderDown: true, vectorless: ["gph_x"] });
    const summary = await runCatchup(deps, {}, 10);

    expect(summary).toMatchObject({ assigned: 1, healed: 0 });
    expect(calls.assigned).toEqual([["a", false]]);
    expect(calls.healed).toEqual([]);
  });

  it("gives vectorless wordings their vector once the embedder works", async () => {
    const { deps, calls } = fake([], { vectorless: ["gph_x", "gph_y"] });
    const summary = await runCatchup(deps, { orgId: "org", projectId: "p1" }, 1);

    expect(summary.healed).toBe(2);
    expect(calls.healed).toEqual(["gph_x", "gph_y"]);
  });

  it("embeds questions with the project's ignored terms removed, here and when healing", async () => {
    const { deps, calls } = fake([row("Deskbell a")], {
      vectorless: ["x"],
      ignoredTerms: ["Deskbell"],
    });
    await runCatchup(deps, { orgId: "org", projectId: "p1" }, 10);

    // "q Deskbell a" and "text x" — the stripped question, then the wording.
    expect(calls.embedded).toEqual([["q a"], ["text x"]]);
  });

  it("fails loudly instead of looping when a slice assigns nothing", async () => {
    const { deps } = fake([row("ghost")]);
    // The row exists in loadUnassigned but assign cannot find it — the real
    // shape of a message deleted between the two reads.
    deps.assign = async () => null;

    await expect(runCatchup(deps, {}, 10)).rejects.toThrow(/stalled/);
  });
});
