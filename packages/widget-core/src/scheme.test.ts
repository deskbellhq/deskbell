import { describe, expect, it } from "vitest";
import { schemeFromAttributes } from "./scheme";

describe("schemeFromAttributes", () => {
  it("reads data attributes first, then a dark or light class", () => {
    expect(schemeFromAttributes({ dataTheme: "dark" })).toBe("dark");
    expect(schemeFromAttributes({ dataColorMode: "Light" })).toBe("light");
    expect(schemeFromAttributes({ dataBsTheme: "dark", className: "light" })).toBe("dark");
    expect(schemeFromAttributes({ className: "prose dark other" })).toBe("dark");
    expect(schemeFromAttributes({ className: "theme-light" })).toBeNull();
    expect(schemeFromAttributes({})).toBeNull();
  });
});
