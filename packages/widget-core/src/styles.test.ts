import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PARTS, SLOTS, TOKENS } from "@deskbell/shared/widget-config";
import { describe, expect, it } from "vitest";
import { CSS } from "./styles.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const panelSource = read("./panel.tsx");
// Structural elements live in the panel and in the answer renderer.
const partSources = panelSource + read("./markdown/render.tsx") + read("./sidebar.tsx");

describe("theme tokens", () => {
  it("wires every declared token into the stylesheet", () => {
    // TOKENS is what the docs and the dashboard promise is customizable.
    // A token nobody reads is a documented API that silently does nothing.
    for (const token of TOKENS) {
      expect(CSS, token).toContain(`--_${token}: var(--deskbell-${token},`);
    }
  });

  it("reads config below the host page for every token", () => {
    for (const token of TOKENS) {
      expect(CSS, token).toContain(`var(--_cfg-${token},`);
    }
  });

  it("keeps the four pre-existing custom properties working", () => {
    // apps/web/app/(dashboard)/layout.tsx and every snippet already published
    // set these. Renaming them is a breaking change, forever.
    for (const legacy of ["accent", "radius", "font", "z"]) {
      expect(CSS).toContain(`var(--deskbell-${legacy},`);
    }
  });
});

describe("colour schemes", () => {
  const paletteKeys = (block: string) => [...block.matchAll(/--_pal-([a-z-]+):/g)].map((m) => m[1]);
  const blockAfter = (marker: string) => {
    const start = CSS.indexOf(marker);
    expect(start, marker).toBeGreaterThan(-1);
    return CSS.slice(start, CSS.indexOf("}", start));
  };

  it("defines light and dark with the same keys", () => {
    const light = paletteKeys(blockAfter('.root[data-scheme="light"]'));
    const dark = paletteKeys(blockAfter('.root[data-scheme="dark"]'));
    expect(light.length).toBeGreaterThan(10);
    expect(new Set(dark)).toEqual(new Set(light));
  });

  it("gives auto a light palette before the dark media query", () => {
    // A colour defined only inside the media block leaves light mode blank.
    const autoLight = CSS.indexOf('.root[data-scheme="light"], .root[data-scheme="auto"]');
    const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
    expect(autoLight).toBeGreaterThan(-1);
    expect(media).toBeGreaterThan(autoLight);
    const autoDark = paletteKeys(CSS.slice(media));
    expect(new Set(autoDark)).toEqual(
      new Set(paletteKeys(blockAfter('.root[data-scheme="dark"]'))),
    );
  });

  it("keeps every text tier at AA contrast on the panel surface", () => {
    // Labels, timestamps and placeholders use the muted and subtle tiers at
    // 11px, so they need the small-text ratio (4.5:1), not the large-text one.
    const channel = (hex: string, at: number) => {
      const v = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (a: string, b: string) => {
      const hi = Math.max(luminance(a), luminance(b));
      const lo = Math.min(luminance(a), luminance(b));
      return (hi + 0.05) / (lo + 0.05);
    };
    const value = (block: string, key: string) => {
      const match = block.match(new RegExp(`--_pal-${key}: #([0-9a-f]{3}|[0-9a-f]{6});`));
      expect(match, key).not.toBeNull();
      const hex = (match as RegExpMatchArray)[1] ?? "";
      // `#fff` is the light surface; expand shorthand before reading channels.
      return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`;
    };
    for (const marker of ['.root[data-scheme="light"]', '.root[data-scheme="dark"]']) {
      const block = blockAfter(marker);
      const surface = value(block, "surface");
      for (const tier of ["text", "text-secondary", "text-muted", "text-subtle"]) {
        expect(contrast(value(block, tier), surface), `${marker} ${tier}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("never hardcodes the old palette hexes outside the palette blocks", () => {
    const body = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
    for (const hex of ["#f2f3f5", "#737a80", "#ebedef", "#0b0e11"]) {
      expect(body, hex).not.toContain(hex);
    }
  });
});

describe("::part surface", () => {
  it("exposes every part the docs advertise", () => {
    for (const part of PARTS) {
      // Literal, or the first word of a computed part list.
      expect(partSources, part).toMatch(new RegExp(`part=(?:"${part}"|\\{citationParts)`));
    }
  });
});

describe("slots", () => {
  it("renders each named slot with the default markup as fallback", () => {
    for (const slot of SLOTS) {
      expect(panelSource, slot).toMatch(new RegExp(`<slot name="${slot}"`));
    }
  });
});
