import { beforeEach, describe, expect, it } from "vitest";

import { acquireSlot, resetSlots } from "./concurrency";

describe("acquireSlot", () => {
  beforeEach(resetSlots);

  it("hands out up to the limit and then refuses", () => {
    expect(acquireSlot("a", 2)).not.toBeNull();
    expect(acquireSlot("a", 2)).not.toBeNull();
    expect(acquireSlot("a", 2)).toBeNull();
  });

  it("frees the slot on release", () => {
    const first = acquireSlot("a", 1);
    expect(acquireSlot("a", 1)).toBeNull();
    first?.release();
    expect(acquireSlot("a", 1)).not.toBeNull();
  });

  it("ignores a double release — otherwise one caller mints slots", () => {
    const slot = acquireSlot("a", 1);
    slot?.release();
    slot?.release();
    expect(acquireSlot("a", 1)).not.toBeNull();
    expect(acquireSlot("a", 1)).toBeNull();
  });

  it("counts callers separately", () => {
    expect(acquireSlot("a", 1)).not.toBeNull();
    expect(acquireSlot("b", 1)).not.toBeNull();
  });

  it("treats a limit of zero as unlimited, matching the env convention", () => {
    for (let i = 0; i < 50; i++) expect(acquireSlot("a", 0)).not.toBeNull();
  });
});
