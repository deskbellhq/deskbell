import { describe, expect, it } from "vitest";
import { type PurgeDeps, runPurge } from "./purge-conversations";

interface Project {
  orgId: string;
  projectId: string;
  days: number;
  /** Rows past the window right now. */
  backlog: number;
  fail?: boolean;
}

function fake(projects: Project[]) {
  const recorded: Array<{ projectId: string; removed: number; at: Date }> = [];
  const batches: Array<{ projectId: string; limit: number; went: number }> = [];
  const deps: PurgeDeps = {
    async listProjects() {
      return projects
        .filter((p) => p.days > 0)
        .map(({ orgId, projectId, days }) => ({ orgId, projectId, days }));
    },
    async deleteBatch(scope, _days, limit) {
      const project = projects.find((p) => p.projectId === scope.projectId);
      if (!project) return 0;
      if (project.fail) throw new Error(`boom ${scope.projectId}`);
      const went = Math.min(limit, project.backlog);
      project.backlog -= went;
      batches.push({ projectId: scope.projectId, limit, went });
      return went;
    },
    async record(scope, removed, at) {
      recorded.push({ projectId: scope.projectId, removed, at });
    },
  };
  return { deps, recorded, batches };
}

const at = new Date("2026-09-23T10:41:00Z");

describe("runPurge", () => {
  it("drains a backlog in batches and records the total", async () => {
    const { deps, recorded, batches } = fake([
      { orgId: "org", projectId: "p1", days: 30, backlog: 2500 },
    ]);
    const summary = await runPurge(deps, {}, { batch: 1000, now: () => at });

    expect(summary).toEqual({
      projects: [{ orgId: "org", projectId: "p1", days: 30, removed: 2500, capped: false }],
      removed: 2500,
    });
    expect(batches.map((b) => b.went)).toEqual([1000, 1000, 500]);
    expect(recorded).toEqual([{ projectId: "p1", removed: 2500, at }]);
  });

  it("records a run that removed nothing, so the status line stays honest", async () => {
    const { deps, recorded } = fake([{ orgId: "org", projectId: "p1", days: 90, backlog: 0 }]);
    const summary = await runPurge(deps, {}, { now: () => at });

    expect(summary.removed).toBe(0);
    expect(recorded).toEqual([{ projectId: "p1", removed: 0, at }]);
  });

  it("stops at the cap with rows left and says so", async () => {
    const { deps, batches } = fake([{ orgId: "org", projectId: "p1", days: 30, backlog: 5000 }]);
    const summary = await runPurge(deps, {}, { batch: 1000, maxBatches: 3 });

    expect(batches).toHaveLength(3);
    expect(summary.projects[0]).toMatchObject({ removed: 3000, capped: true });
  });

  it("a backlog that is exactly a multiple of the batch is not reported as capped", async () => {
    const { deps } = fake([{ orgId: "org", projectId: "p1", days: 30, backlog: 2000 }]);
    const summary = await runPurge(deps, {}, { batch: 1000, maxBatches: 3 });

    expect(summary.projects[0]).toMatchObject({ removed: 2000, capped: false });
  });

  it("scopes to the project the job names", async () => {
    const { deps, batches } = fake([
      { orgId: "org", projectId: "p1", days: 30, backlog: 5 },
      { orgId: "org", projectId: "p2", days: 30, backlog: 5 },
    ]);
    await runPurge(deps, { orgId: "org", projectId: "p2" });

    expect(batches.map((b) => b.projectId)).toEqual(["p2"]);
  });

  it("runs every other project when one fails, then throws so the job is retried", async () => {
    const { deps, recorded } = fake([
      { orgId: "org", projectId: "p1", days: 30, backlog: 5, fail: true },
      { orgId: "org", projectId: "p2", days: 30, backlog: 5 },
    ]);

    await expect(runPurge(deps, {})).rejects.toThrow(/1 of 2 projects.*p1: boom p1/);
    expect(recorded.map((r) => r.projectId)).toEqual(["p2"]);
  });
});
