import { describe, expect, it } from "vitest";

import { createQueryPlanner, readPlanningMode } from "./query-planner";

/**
 * Policy only. What the planner asks the model for is pinned by the prompt
 * tests below; whether the model obeys is the eval harness's job (D8).
 */

const env = (init: Record<string, string> = {}) => init as unknown as NodeJS.ProcessEnv;

/** Blows up if the planner tries to reach a model when it should not. */
const forbiddenModel = () => {
  throw new Error("no model may be constructed or called on this path");
};

describe("readPlanningMode", () => {
  it("defaults to followups when unset", () => {
    expect(readPlanningMode(env())).toBe("followups");
  });

  it("accepts the three modes, case and space insensitively", () => {
    expect(readPlanningMode(env({ DESKBELL_QUERY_PLANNING: " Always " }))).toBe("always");
    expect(readPlanningMode(env({ DESKBELL_QUERY_PLANNING: "OFF" }))).toBe("off");
  });

  it("falls back to followups on a typo rather than silently disabling planning", () => {
    // The dangerous reading of an unknown value is "off" — quality would drop
    // with nothing to show for it.
    expect(readPlanningMode(env({ DESKBELL_QUERY_PLANNING: "follow-ups" }))).toBe("followups");
  });
});

describe("createQueryPlanner", () => {
  it("is undefined when planning is off, so the engine takes its old path", () => {
    const planner = createQueryPlanner(
      forbiddenModel,
      env({ DESKBELL_QUERY_PLANNING: "off" }),
      "openai/gpt-5-mini",
    );

    expect(planner).toBeUndefined();
  });

  it("spends nothing on a first turn in followups mode", async () => {
    // Nothing to resolve, so the call would be pure latency in front of the
    // answer. `forbiddenModel` proves no model is even constructed.
    const planner = createQueryPlanner(forbiddenModel, env(), "openai/gpt-5-mini");

    const plan = await planner?.({ message: "How do I add a source?" });

    expect(plan).toEqual({
      canonicalQuestion: "How do I add a source?",
      queries: ["How do I add a source?"],
    });
  });

  it("treats empty history as a first turn", async () => {
    const planner = createQueryPlanner(forbiddenModel, env(), "openai/gpt-5-mini");

    const plan = await planner?.({ message: "How do I add a source?", history: [] });

    expect(plan?.queries).toEqual(["How do I add a source?"]);
  });
});
