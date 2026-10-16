import { describe, expect, it } from "vitest";
import {
  CONVERSATION_RETENTION_MAX_DAYS,
  CONVERSATION_RETENTION_PRESETS,
  ConversationRetentionDaysSchema,
} from "./index";

describe("ConversationRetentionDaysSchema", () => {
  it("reads a form field: digits parse, blank is keep-forever", () => {
    expect(ConversationRetentionDaysSchema.parse("90")).toBe(90);
    expect(ConversationRetentionDaysSchema.parse("")).toBe(0);
    expect(ConversationRetentionDaysSchema.parse("  ")).toBe(0);
    expect(ConversationRetentionDaysSchema.parse(30)).toBe(30);
  });

  it("refuses fractions, negatives and windows past the ceiling", () => {
    expect(ConversationRetentionDaysSchema.safeParse("1.5").success).toBe(false);
    expect(ConversationRetentionDaysSchema.safeParse("-1").success).toBe(false);
    expect(ConversationRetentionDaysSchema.safeParse("abc").success).toBe(false);
    expect(
      ConversationRetentionDaysSchema.safeParse(CONVERSATION_RETENTION_MAX_DAYS + 1).success,
    ).toBe(false);
    expect(ConversationRetentionDaysSchema.parse(CONVERSATION_RETENTION_MAX_DAYS)).toBe(
      CONVERSATION_RETENTION_MAX_DAYS,
    );
  });

  it("offers keep-forever first among the presets, all within bounds", () => {
    expect(CONVERSATION_RETENTION_PRESETS[0]).toBe(0);
    for (const days of CONVERSATION_RETENTION_PRESETS) {
      expect(ConversationRetentionDaysSchema.parse(days)).toBe(days);
    }
  });
});
