import { PARTS, SLOTS, TOKENS, WIDGET_OPTIONS } from "@deskbell/shared/widget-config";
import { TOKEN_HELP, WIDGET_OPTION_META } from "@deskbell/shared/widget-config-meta";
import { describe, expect, it } from "vitest";

/**
 * The widget reference on the customization page renders from the descriptor,
 * so it can never document an option the widget does not have. The reverse is
 * still possible: adding an option without help text renders a row with a blank
 * description, which reads as an oversight to anyone using it.
 *
 * These fail the build instead.
 */

const GROUPS = ["Identity", "Theme", "Launcher", "Behaviour", "Content"] as const;

describe("widget reference", () => {
  it("has help text and a group for every option", () => {
    for (const option of WIDGET_OPTIONS) {
      const meta = WIDGET_OPTION_META[option.key];

      expect(meta, `no metadata for option "${option.key}"`).toBeDefined();
      expect(meta.help.trim(), `empty help for option "${option.key}"`).not.toBe("");
      expect(meta.label.trim(), `empty label for option "${option.key}"`).not.toBe("");
    }
  });

  it("puts every option in a group the page renders", () => {
    // The page renders one table per group. An option in a group with no table
    // is documented nowhere, which is worse than an empty cell.
    for (const option of WIDGET_OPTIONS) {
      expect(GROUPS).toContain(WIDGET_OPTION_META[option.key].group);
    }
  });

  it("has help text for every theme token", () => {
    for (const token of TOKENS) {
      expect(TOKEN_HELP[token]?.trim(), `empty help for token "${token}"`).toBeTruthy();
    }
  });

  it("has parts and slots to document", () => {
    expect(PARTS.length).toBeGreaterThan(0);
    expect(SLOTS.length).toBeGreaterThan(0);
  });
});
