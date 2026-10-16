import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

const text = (v: string) => ({ t: "text", v });

describe("blocks", () => {
  it("splits paragraphs on blank lines and keeps single newlines as breaks", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { t: "p", c: [text("one"), { t: "br" }, text("two")] },
      { t: "p", c: [text("three")] },
    ]);
  });

  it("parses headings, rules and quotes", () => {
    expect(parseMarkdown("# Title\n---\n> quoted\n> more")).toEqual([
      { t: "h", level: 1, c: [text("Title")] },
      { t: "hr" },
      { t: "quote", c: [{ t: "p", c: [text("quoted"), { t: "br" }, text("more")] }] },
    ]);
  });

  it("parses bullet and numbered lists with one nested level", () => {
    const md = "1. First\n2. Second\n   - inner a\n   - inner b\n3. Third";
    expect(parseMarkdown(md)).toEqual([
      {
        t: "ol",
        start: 1,
        items: [
          { c: [text("First")] },
          {
            c: [text("Second")],
            sub: [{ t: "ul", items: [{ c: [text("inner a")] }, { c: [text("inner b")] }] }],
          },
          { c: [text("Third")] },
        ],
      },
    ]);
    expect(parseMarkdown("- a\n* b\n+ c")).toEqual([
      { t: "ul", items: [{ c: [text("a")] }, { c: [text("b")] }, { c: [text("c")] }] },
    ]);
    expect(parseMarkdown("3) x")).toEqual([{ t: "ol", start: 3, items: [{ c: [text("x")] }] }]);
  });

  it("joins indented continuation lines into the item", () => {
    expect(parseMarkdown("- a\n  continues\n- b")).toEqual([
      { t: "ul", items: [{ c: [text("a"), { t: "br" }, text("continues")] }, { c: [text("b")] }] },
    ]);
  });

  it("parses fenced code verbatim and keeps an unterminated fence open", () => {
    expect(parseMarkdown("```ts\nconst a = **1**;\n```\nafter")).toEqual([
      { t: "code", lang: "ts", v: "const a = **1**;" },
      { t: "p", c: [text("after")] },
    ]);
    expect(parseMarkdown("```\nstill streaming\n<script>")).toEqual([
      { t: "code", lang: "", v: "still streaming\n<script>" },
    ]);
  });

  it("ends a paragraph where a list or heading begins", () => {
    expect(parseMarkdown("intro:\n- a\n## next")).toEqual([
      { t: "p", c: [text("intro:")] },
      { t: "ul", items: [{ c: [text("a")] }] },
      { t: "h", level: 2, c: [text("next")] },
    ]);
  });
});

describe("inline", () => {
  it("handles strong, emphasis and code, code winning over emphasis", () => {
    expect(parseInline("**bold** and *em* and `a_b_c`")).toEqual([
      { t: "strong", c: [text("bold")] },
      text(" and "),
      { t: "em", c: [text("em")] },
      text(" and "),
      { t: "code", v: "a_b_c" },
    ]);
  });

  it("keeps underscores inside words as text", () => {
    expect(parseInline("snake_case_name and _em_")).toEqual([
      text("snake_case_name and "),
      { t: "em", c: [text("em")] },
    ]);
  });

  it("leaves an unmatched delimiter literal, as it is mid-stream", () => {
    expect(parseInline("half **bold")).toEqual([text("half **bold")]);
    expect(parseInline("tick ` alone")).toEqual([text("tick ` alone")]);
  });

  it("keeps balanced parentheses inside a link target", () => {
    expect(parseInline("[w](https://w.test/A_(b))")).toEqual([
      { t: "link", href: "https://w.test/A_(b)", c: [text("w")] },
    ]);
  });

  it("parses links, drops unsafe targets, autolinks bare URLs", () => {
    expect(
      parseInline("[docs](https://x.test/a) [bad](javascript:alert(1)) see https://y.test/b."),
    ).toEqual([
      { t: "link", href: "https://x.test/a", c: [text("docs")] },
      text(" "),
      text("bad"),
      text(" see "),
      { t: "link", href: "https://y.test/b", c: [text("https://y.test/b")] },
      text("."),
    ]);
  });

  it("never produces markup from raw HTML", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([
      text('<img src=x onerror="alert(1)">'),
    ]);
  });
});

describe("safeHref", () => {
  it("allows http, https, mailto, anchors and root-relative paths only", () => {
    expect(safeHref("https://a.test")).toBe("https://a.test");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("/docs")).toBe("/docs");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("//evil.test")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
  });
});
