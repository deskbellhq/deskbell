import { describe, expect, it, vi } from "vitest";
import { ownDataFromEnv } from "./own-data-config";

describe("ownDataFromEnv", () => {
  it("is off unless the operator turned it on", () => {
    expect(ownDataFromEnv({})).toBe(false);
    expect(ownDataFromEnv({ DESKBELL_OWN_DATA: "off" })).toBe(false);
    expect(ownDataFromEnv({ DESKBELL_OWN_DATA: " ON " })).toBe(true);
  });

  it("ignores garbage rather than guessing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(ownDataFromEnv({ DESKBELL_OWN_DATA: "yes" })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
