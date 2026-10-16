import { describe, expect, it } from "vitest";
import { agentPrompt, manualSnippet, oneTagSnippet } from "./widget-snippet";

const BASE = "https://help.example.com";
const KEY = "pk_live_abc123";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("oneTagSnippet", () => {
  it("is one async script tag carrying the loader URL and the key", () => {
    const tag = oneTagSnippet(BASE, KEY);
    expect(tag).toBe(`<script async src="${BASE}/deskbell.js" data-project-key="${KEY}"></script>`);
    expect(count(tag, "/deskbell.js")).toBe(1);
    expect(count(tag, KEY)).toBe(1);
  });

  it("never doubles the slash when the base URL carries one", () => {
    expect(oneTagSnippet(`${BASE}/`, KEY)).toBe(oneTagSnippet(BASE, KEY));
  });
});

describe("manualSnippet", () => {
  it("names the API explicitly because the element cannot derive it", () => {
    const snippet = manualSnippet(BASE, KEY);
    expect(snippet).toContain(`<script async src="${BASE}/deskbell.js"></script>`);
    expect(snippet).toContain(`project-key="${KEY}"`);
    expect(snippet).toContain(`api-url="${BASE}"`);
    expect(snippet).not.toContain("data-project-key");
  });

  it("normalises a trailing slash in both places it renders the base", () => {
    expect(manualSnippet(`${BASE}//`, KEY)).toBe(manualSnippet(BASE, KEY));
  });
});

describe("agentPrompt", () => {
  it("carries the exact tag, the CSP directives, the double-install warning and the docs link", () => {
    const prompt = agentPrompt(BASE, KEY);
    expect(prompt).toContain(oneTagSnippet(BASE, KEY));
    expect(prompt).toContain("script-src");
    expect(prompt).toContain("connect-src");
    expect(prompt).toContain(`allow ${BASE} in both`);
    expect(prompt).toContain("Do not add the tag twice");
    expect(prompt).toContain("Settings › Install");
    expect(prompt).toContain("https://deskbell.dev/docs/widget/install");
  });

  it("takes an explicit docs URL and normalises the base", () => {
    const prompt = agentPrompt(`${BASE}/`, KEY, "https://docs.internal/install");
    expect(prompt).toContain(oneTagSnippet(BASE, KEY));
    expect(prompt.endsWith("Reference: https://docs.internal/install")).toBe(true);
  });
});
