import { describe, expect, it } from "vitest";
import { WidgetAppearanceSchema } from "./index";
import {
  coerceConfigObject,
  configFromAttributes,
  configToCssVars,
  DEFAULTS,
  parseContext,
  parseFeedbackReasons,
  parsePromptGroups,
  resolveWidgetConfig,
  sanitizeCssValue,
  TOKENS,
  WIDGET_OPTIONS,
} from "./widget-config";

const attrs = (map: Record<string, string>) => (attr: string) => map[attr] ?? null;

describe("descriptor integrity", () => {
  it("gives every option a default", () => {
    for (const option of WIDGET_OPTIONS) {
      expect(DEFAULTS[option.key], option.key).toBeDefined();
    }
  });

  it("uses unique keys and attribute names", () => {
    expect(new Set(WIDGET_OPTIONS.map((o) => o.key)).size).toBe(WIDGET_OPTIONS.length);
    expect(new Set(WIDGET_OPTIONS.map((o) => o.attr)).size).toBe(WIDGET_OPTIONS.length);
  });

  it("keeps the four pre-existing CSS custom properties", () => {
    // apps/web/app/(dashboard)/layout.tsx and every published snippet rely on
    // --deskbell-accent/-radius/-font/-z. These names are load-bearing forever.
    for (const legacy of ["accent", "radius", "font", "z"]) {
      expect(TOKENS).toContain(legacy);
    }
  });
});

describe("attribute coercion", () => {
  it("reads strings, enums, ints and booleans", () => {
    const config = configFromAttributes(
      attrs({
        "project-key": "pk_live_1",
        "color-scheme": "dark",
        "offset-x": "32",
        "open-on-load": "true",
        feedback: "false",
      }),
    );
    expect(config).toMatchObject({
      projectKey: "pk_live_1",
      colorScheme: "dark",
      offsetX: 32,
      openOnLoad: true,
      feedback: false,
    });
  });

  it("treats a bare boolean attribute as true", () => {
    expect(configFromAttributes(attrs({ "open-on-load": "" })).openOnLoad).toBe(true);
  });

  it("falls back to the default on an invalid enum or int", () => {
    const config = configFromAttributes(attrs({ "color-scheme": "neon", "offset-x": "abc" }));
    expect(config.colorScheme).toBe(DEFAULTS.colorScheme);
    expect(config.offsetX).toBe(DEFAULTS.offsetX);
  });

  it("clamps ints to the declared maximum", () => {
    expect(configFromAttributes(attrs({ "offset-y": "99999" })).offsetY).toBe(512);
  });

  it("splits suggested questions on | and caps them at four", () => {
    const raw = "How do I install?|What is pricing, exactly?|A|B|C|D";
    expect(configFromAttributes(attrs({ "suggested-questions": raw })).suggestedQuestions).toEqual([
      "How do I install?",
      "What is pricing, exactly?",
      "A",
      "B",
    ]);
  });

  it("ignores unknown theme and copy keys", () => {
    const config = configFromAttributes(
      attrs({
        theme: '{"surface":"#fff","nope":"#000"}',
        copy: '{"title":"Ask us","bogus":"x"}',
      }),
    );
    expect(config.theme).toEqual({ surface: "#fff" });
    expect(config.copy).toEqual({ title: "Ask us" });
  });

  it("survives malformed JSON", () => {
    expect(configFromAttributes(attrs({ theme: "{not json" })).theme).toEqual({});
  });

  it("omits attributes that are absent, so lower layers show through", () => {
    expect(configFromAttributes(attrs({}))).toEqual({});
  });
});

describe("sanitizeCssValue", () => {
  it("keeps ordinary CSS values intact", () => {
    expect(sanitizeCssValue("#2b6b4f")).toBe("#2b6b4f");
    expect(sanitizeCssValue("rgb(43 107 79 / 80%)")).toBe("rgb(43 107 79 / 80%)");
    expect(sanitizeCssValue("system-ui, -apple-system, sans-serif")).toBe(
      "system-ui, -apple-system, sans-serif",
    );
  });

  it("strips characters that could break out of a declaration", () => {
    expect(sanitizeCssValue("red; } :host { display: none")).toBe("red :host display: none");
    expect(sanitizeCssValue('#fff"</style><script>')).toBe("#fff/stylescript");
    expect(sanitizeCssValue("@import url(evil)")).toBe("import url(evil)");
  });
});

describe("resolveWidgetConfig", () => {
  it("applies layers in order, later winning", () => {
    const resolved = resolveWidgetConfig(
      { accent: "#111111" },
      { accent: "#222222" },
      { accent: "#333333" },
    );
    expect(resolved.accent).toBe("#333333");
  });

  it("merges theme and copy key by key instead of replacing them", () => {
    const resolved = resolveWidgetConfig(
      { theme: { surface: "#fff", text: "#000" }, copy: { title: "A", send: "Go" } },
      { theme: { surface: "#eee" }, copy: { title: "B" } },
    );
    expect(resolved.theme).toEqual({ surface: "#eee", text: "#000" });
    expect(resolved.copy).toEqual({ title: "B", send: "Go" });
  });

  it("fills unspecified options from the defaults", () => {
    expect(resolveWidgetConfig({ accent: "#000" }).radius).toBe(DEFAULTS.radius);
  });

  it("does not leak mutable state between calls", () => {
    resolveWidgetConfig({ theme: { surface: "#fff" } });
    expect(resolveWidgetConfig({}).theme).toEqual({});
  });
});

describe("coerceConfigObject", () => {
  it("accepts well-formed values and drops unknown keys", () => {
    const config = coerceConfigObject({
      accent: "#ff0000",
      offsetX: 40,
      conversationHistory: false,
      suggestedQuestions: ["a", "b"],
      somethingElse: "ignored",
    });
    expect(config).toEqual({
      accent: "#ff0000",
      offsetX: 40,
      conversationHistory: false,
      suggestedQuestions: ["a", "b"],
    });
  });

  it("ignores null and undefined so they never clobber a lower layer", () => {
    expect(coerceConfigObject({ accent: null, radius: undefined })).toEqual({});
  });
});

describe("configToCssVars", () => {
  it("emits shorthands and offsets", () => {
    const css = configToCssVars(resolveWidgetConfig({ accent: "#abcdef", offsetX: 8 }));
    expect(css).toContain("--_cfg-accent:#abcdef");
    expect(css).toContain("--_cfg-launcher-offset-x:8px");
  });

  it("lets an explicit theme token override the shorthand", () => {
    const css = configToCssVars(
      resolveWidgetConfig({ accent: "#111111", theme: { accent: "#222222" } }),
    );
    expect(css.lastIndexOf("--_cfg-accent:#222222")).toBeGreaterThan(
      css.indexOf("--_cfg-accent:#111111"),
    );
  });

  it("cannot emit a declaration that escapes its rule", () => {
    const css = configToCssVars(
      resolveWidgetConfig({ theme: { surface: "#fff; } * {color:red" } }),
    );
    expect(css).not.toContain("}");
    expect(css).not.toContain("; }");
  });
});

describe("WidgetAppearanceSchema", () => {
  it("accepts a realistic dashboard payload", () => {
    const result = WidgetAppearanceSchema.safeParse({
      colorScheme: "auto",
      accent: "#2b6b4f",
      launcherLabel: "Ask AI",
      suggestedQuestions: ["How do I install Deskbell?"],
      theme: { "bubble-user-bg": "#123456" },
      copy: { title: "Ask our docs" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects client-only options", () => {
    expect(WidgetAppearanceSchema.safeParse({ projectKey: "pk_x" }).success).toBe(false);
    expect(WidgetAppearanceSchema.safeParse({ poweredBy: false }).success).toBe(false);
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    expect(WidgetAppearanceSchema.safeParse({ acccent: "#fff" }).success).toBe(false);
  });

  it("rejects CSS values carrying syntax characters", () => {
    expect(WidgetAppearanceSchema.safeParse({ accent: "red; } * { color: red" }).success).toBe(
      false,
    );
  });

  it("rejects unknown theme tokens and over-long question lists", () => {
    expect(WidgetAppearanceSchema.safeParse({ theme: { nope: "#fff" } }).success).toBe(false);
    expect(
      WidgetAppearanceSchema.safeParse({ suggestedQuestions: ["a", "b", "c", "d", "e"] }).success,
    ).toBe(false);
  });
});

describe("welcome cards, feedback reasons, inline mode", () => {
  const group = {
    title: "Import",
    description: "Get data in",
    icon: "https://x.test/i.svg",
    prompts: ["How?"],
  };

  it("coerces prompt groups from an attribute and from an object", () => {
    const fromAttr = configFromAttributes(attrs({ "prompt-groups": JSON.stringify([group]) }));
    expect(fromAttr.promptGroups).toEqual([group]);
    expect(coerceConfigObject({ promptGroups: [group] }).promptGroups).toEqual([group]);
  });

  it("drops malformed groups, unsafe icons, and caps counts", () => {
    const groups = parsePromptGroups([
      { title: "no prompts", prompts: [] },
      { title: "", prompts: ["x"] },
      { title: "bad icon", icon: "javascript:alert(1)", prompts: ["x"] },
      { title: "data icon", icon: "data:image/svg+xml;base64,AAAA", prompts: ["x"] },
      { title: "many", prompts: ["1", "2", "3", "4", "5", "6", "7"] },
      "not an object",
    ]);
    expect(groups).toEqual([
      { title: "bad icon", prompts: ["x"] },
      { title: "data icon", icon: "data:image/svg+xml;base64,AAAA", prompts: ["x"] },
      { title: "many", prompts: ["1", "2", "3", "4", "5", "6"] },
    ]);
    expect(
      parsePromptGroups(Array.from({ length: 12 }, (_, i) => ({ title: `g${i}`, prompts: ["p"] }))),
    ).toHaveLength(8);
    expect(parsePromptGroups("nope")).toEqual([]);
    expect(configFromAttributes(attrs({ "prompt-groups": "{not json" })).promptGroups).toEqual([]);
  });

  it("coerces feedback reasons and rejects ids the server would refuse", () => {
    expect(
      parseFeedbackReasons([
        { id: "incomplete", label: "Incomplete" },
        { id: "other", label: "Other", note: 300 },
        { id: "Bad Id", label: "x" },
        { id: "dup", label: "a" },
        { id: "dup", label: "b" },
        { id: "huge", label: "Huge", note: 99999 },
        { id: "nonote", label: "N", note: 0 },
      ]),
    ).toEqual([
      { id: "incomplete", label: "Incomplete" },
      { id: "other", label: "Other", note: 300 },
      { id: "dup", label: "a" },
      { id: "huge", label: "Huge", note: 2000 },
      { id: "nonote", label: "N" },
    ]);
  });

  it("validates both through the appearance schema", () => {
    expect(WidgetAppearanceSchema.safeParse({ promptGroups: [group] }).success).toBe(true);
    expect(
      WidgetAppearanceSchema.safeParse({ promptGroups: [{ ...group, icon: "javascript:x" }] })
        .success,
    ).toBe(false);
    expect(
      WidgetAppearanceSchema.safeParse({
        feedbackReasons: [{ id: "other", label: "Other", note: 300 }],
      }).success,
    ).toBe(true);
    expect(
      WidgetAppearanceSchema.safeParse({ feedbackReasons: [{ id: "Bad!", label: "x" }] }).success,
    ).toBe(false);
  });

  it("reads mode and disclaimer, falling back on an unknown mode", () => {
    const config = configFromAttributes(
      attrs({ mode: "inline", disclaimer: "AI answers. [Policy](https://p.test)" }),
    );
    expect(config.mode).toBe("inline");
    expect(config.disclaimer).toBe("AI answers. [Policy](https://p.test)");
    expect(configFromAttributes(attrs({ mode: "sideways" })).mode).toBe("floating");
  });
});

describe("context and thread options", () => {
  it("coerces context from JSON, dropping bad keys and values", () => {
    const ctx = parseContext({
      account: { id: "a1", name: "Acme" },
      site: { id: "s1" },
      "bad key": { id: "x" },
      empty: { id: "" },
      notObject: "x",
    });
    expect(ctx).toEqual({ account: { id: "a1", name: "Acme" }, site: { id: "s1" } });
    expect(configFromAttributes(attrs({ context: JSON.stringify(ctx) })).context).toEqual(ctx);
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, { id: "1" }]));
    expect(Object.keys(parseContext(many))).toHaveLength(8);
  });

  it("never accepts context from the server", () => {
    expect(WidgetAppearanceSchema.safeParse({ context: { a: { id: "1" } } }).success).toBe(false);
  });

  it("reads the thread options with their defaults", () => {
    const c = resolveWidgetConfig({});
    expect(c.historyLayout).toBe("stack");
    expect(c.resumeThread).toBe("last");
    expect(c.threadIdleMinutes).toBe(30);
    const set = configFromAttributes(
      attrs({
        "history-layout": "sidebar",
        "resume-thread": "newest",
        "thread-idle-minutes": "0",
        "scope-key": "site",
      }),
    );
    expect(set).toMatchObject({
      historyLayout: "sidebar",
      resumeThread: "newest",
      threadIdleMinutes: 0,
      scopeKey: "site",
    });
  });
});
