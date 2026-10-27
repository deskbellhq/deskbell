import { describe, expect, it } from "vitest";
import type { ClassifyOutcome } from "./classify-question";
import { runTopicsCatchup, type TopicsCatchupDeps } from "./topics-catchup";

function fake(pending: Record<string, string[]>, outcome: (id: string) => ClassifyOutcome) {
  const classified: string[] = [];
  const deps: TopicsCatchupDeps = {
    async listProjects() {
      return Object.keys(pending).map((projectId) => ({ orgId: "org", projectId }));
    },
    async loadUnlabelled(scope, limit) {
      return (pending[scope.projectId] ?? []).slice(0, limit);
    },
    async classify(_scope, id) {
      classified.push(id);
      return outcome(id);
    },
  };
  return { deps, classified };
}

describe("runTopicsCatchup", () => {
  it("labels every project's backlog, oldest first, up to the cap", async () => {
    const f = fake({ p1: ["a", "b", "c"], p2: ["d"] }, () => "labelled");
    const summary = await runTopicsCatchup(f.deps, {}, 2);
    expect(f.classified).toEqual(["a", "b", "d"]);
    expect(summary).toEqual({ projects: 2, labelled: 3, budget: 0 });
  });

  it("stops a project at its budget and moves on", async () => {
    const f = fake({ p1: ["a", "b"], p2: ["c"] }, (id) => (id === "a" ? "budget" : "labelled"));
    const summary = await runTopicsCatchup(f.deps, {});
    expect(f.classified).toEqual(["a", "c"]);
    expect(summary).toEqual({ projects: 2, labelled: 1, budget: 1 });
  });

  it("ends a project's run when its switch turned off", async () => {
    const f = fake({ p1: ["a", "b"], p2: ["c"] }, (id) => (id === "a" ? "off" : "labelled"));
    const summary = await runTopicsCatchup(f.deps, {});
    expect(f.classified).toEqual(["a", "c"]);
    expect(summary).toEqual({ projects: 2, labelled: 1, budget: 0 });
  });

  it("runs for one project when the job names it", async () => {
    const f = fake({ p1: ["a"], p2: ["b"] }, () => "labelled");
    await runTopicsCatchup(f.deps, { orgId: "org", projectId: "p2" });
    expect(f.classified).toEqual(["b"]);
  });
});
