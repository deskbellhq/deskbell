import { describe, expect, it } from "vitest";
import { ACTION_DEFAULTS, actionOptionsFromEnv, toolResultForModel } from "./index";

describe("actionOptionsFromEnv (spec: mcp-actions)", () => {
  it("defaults every knob and derives the approval secret from the auth secret", () => {
    const opts = actionOptionsFromEnv({ BETTER_AUTH_SECRET: "s3cret" });
    expect(opts.maxSteps).toBe(ACTION_DEFAULTS.maxSteps);
    expect(opts.timeoutMs).toBe(ACTION_DEFAULTS.timeoutMs);
    expect(opts.resultMaxChars).toBe(ACTION_DEFAULTS.resultMaxChars);
    expect(opts.approvalSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // Never the auth secret itself: a leak of one must not be a leak of the other.
    expect(opts.approvalSecret).not.toBe("s3cret");
  });

  it("reads the knobs and ignores a value that is not a positive integer", () => {
    const opts = actionOptionsFromEnv({
      DESKBELL_ACTION_MAX_STEPS: "6",
      DESKBELL_ACTION_TIMEOUT_MS: "-1",
      DESKBELL_ACTION_RESULT_MAX_CHARS: "lots",
    });
    expect(opts.maxSteps).toBe(6);
    expect(opts.timeoutMs).toBe(ACTION_DEFAULTS.timeoutMs);
    expect(opts.resultMaxChars).toBe(ACTION_DEFAULTS.resultMaxChars);
    expect(opts.approvalSecret).toBeUndefined();
  });
});

describe("toolResultForModel", () => {
  it("fences a result as material and serialises objects", () => {
    expect(toolResultForModel("shop__order", { status: "shipped" }, 100)).toBe(
      '<tool_result tool="shop__order">\n{"status":"shipped"}\n</tool_result>',
    );
  });

  it("keeps strings as they are and cuts long ones", () => {
    const out = toolResultForModel("t", "x".repeat(50), 10);
    expect(out).toBe(`<tool_result tool="t">\n${"x".repeat(10)}\n[truncated]\n</tool_result>`);
  });
});
