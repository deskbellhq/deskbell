import { describe, expect, it } from "vitest";
import { OWN_DATA_REPLY_MAX_LENGTH, ProjectAnsweringSchema } from "./index.ts";

describe("ProjectAnsweringSchema", () => {
  it("accepts no reply, and trims one", () => {
    expect(ProjectAnsweringSchema.parse({})).toEqual({});
    expect(ProjectAnsweringSchema.parse({ ownDataReply: "  I can't see that.  " })).toEqual({
      ownDataReply: "I can't see that.",
    });
  });

  it("never stores a blank reply, and caps the length", () => {
    expect(ProjectAnsweringSchema.safeParse({ ownDataReply: "   " }).success).toBe(false);
    expect(ProjectAnsweringSchema.safeParse({ ownDataReply: "" }).success).toBe(false);
    const long = "x".repeat(OWN_DATA_REPLY_MAX_LENGTH + 1);
    expect(ProjectAnsweringSchema.safeParse({ ownDataReply: long }).success).toBe(false);
  });
});
