import { describe, expect, it, vi } from "vitest";
import { verifyFromEnv } from "./verify-config";

describe("verifyFromEnv", () => {
  it("is on unless the operator turned it off", () => {
    expect(verifyFromEnv({})).toBe(true);
    expect(verifyFromEnv({ DESKBELL_VERIFY: " ON " })).toBe(true);
    expect(verifyFromEnv({ DESKBELL_VERIFY: "off" })).toBe(false);
    expect(verifyFromEnv({ DESKBELL_VERIFY: " Off " })).toBe(false);
  });

  it("ignores garbage rather than guessing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(verifyFromEnv({ DESKBELL_VERIFY: "yes" })).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
