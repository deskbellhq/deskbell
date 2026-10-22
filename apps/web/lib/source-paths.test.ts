import { describe, expect, it } from "vitest";
import { parseIncludePaths } from "./source-paths";

describe("parseIncludePaths", () => {
  it("splits on commas, whitespace and newlines and adds the leading slash", () => {
    expect(parseIncludePaths("/docs, guides\n/api/v2 ")).toEqual(["/docs", "/guides", "/api/v2"]);
  });

  it("keeps only the path of a pasted URL and drops duplicates", () => {
    expect(parseIncludePaths("https://docs.example.com/docs/ /docs/")).toEqual(["/docs/"]);
  });

  it("is empty for an empty field, which means the whole site", () => {
    expect(parseIncludePaths("")).toEqual([]);
    expect(parseIncludePaths("  \n ")).toEqual([]);
  });
});
