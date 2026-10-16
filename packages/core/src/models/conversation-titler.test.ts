import { describe, expect, it } from "vitest";
import { cleanTitle, TITLE_MAX_CHARS } from "./conversation-titler";

describe("cleanTitle", () => {
  it("takes the first non-empty line, strips quotes and a trailing period", () => {
    expect(cleanTitle('\n  "Exporting a report."  \nsecond line')).toBe("Exporting a report");
    expect(cleanTitle("‘Tytuł’")).toBe("Tytuł");
  });

  it("caps long output with an ellipsis and returns empty for nothing", () => {
    const long = cleanTitle("x".repeat(200));
    expect(long.length).toBe(TITLE_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(cleanTitle("   \n  ")).toBe("");
  });
});
