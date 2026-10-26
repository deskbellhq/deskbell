import { describe, expect, it } from "vitest";

import { ANSWER_STYLE_MAX_LENGTH, AnswerStyleSchema } from "./index";

describe("AnswerStyleSchema (spec: answer-style)", () => {
  it("trims, so a blank field stores nothing and hashes like no style", () => {
    expect(AnswerStyleSchema.parse("")).toBe("");
    expect(AnswerStyleSchema.parse("  \n\t ")).toBe("");
    expect(AnswerStyleSchema.parse("  Be brief.\n")).toBe("Be brief.");
  });

  it("keeps line breaks inside the paragraph", () => {
    expect(AnswerStyleSchema.parse("Be brief.\nUse “you”.")).toBe("Be brief.\nUse “you”.");
  });

  it("caps the length after trimming", () => {
    expect(AnswerStyleSchema.safeParse("x".repeat(ANSWER_STYLE_MAX_LENGTH)).success).toBe(true);
    expect(AnswerStyleSchema.safeParse(`${"x".repeat(ANSWER_STYLE_MAX_LENGTH)}  `).success).toBe(
      true,
    );
    expect(AnswerStyleSchema.safeParse("x".repeat(ANSWER_STYLE_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });
});
