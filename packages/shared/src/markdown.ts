/**
 * A small Markdown parser for answers (spec: answer-markdown).
 *
 * Shared by the widget (Preact renderer) and the dashboard (React renderer)
 * so both draw the same tree from the same text. Dependency-free and
 * import-free on purpose: `@deskbell/widget` inlines it at build time and
 * every KB ships on customers' pages.
 *
 * Produces a tree, never HTML, so the renderer can emit vnodes and nothing the
 * model writes is ever interpreted as markup. Covers what answers actually
 * contain: paragraphs, headings, bullet and numbered lists with one level of
 * nesting, fenced and inline code, links, emphasis, block quotes, rules.
 * Tables and images are deliberately out; raw HTML is text.
 *
 * Streaming shapes are first class: an unterminated fence is a code block to
 * the end of the input, and an unmatched `**` is literal text. Both render
 * sensibly while the answer is still arriving and settle when it completes.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem {
  c: Inline[];
  /** A nested list, when the item has one. */
  sub?: Block[];
}

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "ul"; items: ListItem[] }
  | { t: "ol"; start: number; items: ListItem[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "hr" }
  | {
      t: "table";
      align: Array<"left" | "center" | "right" | null>;
      head: Inline[][];
      rows: Inline[][][];
    };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
/** A GFM table's separator row: cells of dashes, optionally colon-aligned. */
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Cells of one table row; a leading and trailing pipe are optional. */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** A table starts only where a header row with a pipe is followed by its separator. */
function startsTable(line: string, next: string | undefined): boolean {
  return line.includes("|") && next !== undefined && next.includes("|") && TABLE_SEP.test(next);
}

/**
 * Only these link targets are followed. Everything else (`javascript:`,
 * `data:`, protocol-relative, unknown schemes) renders as plain text.
 */
export function safeHref(href: string): string | null {
  const v = href.trim();
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v)) return v;
  if (v.startsWith("#") || (v.startsWith("/") && !v.startsWith("//"))) return v;
  return null;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line)
  );
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (l.trim().startsWith(marker[0] ?? "") && l.trim().length >= marker.length) {
          const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
          if (m && (m[1] ?? "")[0] === marker[0]) {
            i++;
            break;
          }
        }
        body.push(l);
        i++;
      }
      out.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }

    if (startsTable(line, lines[i + 1])) {
      const head = tableCells(line);
      const align = tableCells(lines[i + 1] ?? "").map((c) =>
        c.startsWith(":") && c.endsWith(":")
          ? "center"
          : c.endsWith(":")
            ? "right"
            : c.startsWith(":")
              ? "left"
              : null,
      );
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (l.trim() === "" || !l.includes("|")) break;
        const cells = tableCells(l);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
        i++;
      }
      out.push({
        t: "table",
        align: head.map((_, k) => align[k] ?? null),
        head: head.map((c) => parseInline(c)),
        rows,
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ t: "h", level: (heading[1] ?? "#").length, c: parseInline(heading[2] ?? "") });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? "");
        if (!q) break;
        inner.push(q[1] ?? "");
        i++;
      }
      out.push({ t: "quote", c: parseBlocks(inner) });
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      const indent = (list[1] ?? "").length;
      const ordered = /\d/.test(list[2] ?? "");
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i] ?? "");
        if (!m || (m[1] ?? "").length !== indent || /\d/.test(m[2] ?? "") !== ordered) break;
        const text = [m[3] ?? ""];
        const nested: string[] = [];
        i++;
        // Continuation: deeper-indented lines belong to this item. A deeper
        // list marker starts the nested list; plain text joins the item.
        while (i < lines.length) {
          const l = lines[i] ?? "";
          if (l.trim() === "") {
            // A blank line ends the item unless a deeper line follows.
            const next = lines[i + 1] ?? "";
            const deeper = next.length - next.trimStart().length > indent && next.trim() !== "";
            if (!deeper) break;
            i++;
            continue;
          }
          const depth = l.length - l.trimStart().length;
          if (depth <= indent) break;
          if (LIST.test(l) || nested.length > 0) nested.push(l.slice(indent + 2));
          else text.push(l.trim());
          i++;
        }
        const item: ListItem = { c: parseInline(text.join("\n")) };
        if (nested.length > 0) item.sub = parseBlocks(nested);
        items.push(item);
      }
      if (ordered) {
        const start = Number.parseInt(list[2] ?? "1", 10);
        out.push({ t: "ol", start: Number.isFinite(start) ? start : 1, items });
      } else {
        out.push({ t: "ul", items });
      }
      continue;
    }

    // Paragraph: consecutive non-blank lines until another block begins.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.trim() === "" || startsBlock(l) || startsTable(l, lines[i + 1])) break;
      para.push(l.trim());
      i++;
    }
    out.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return out;
}

// The target may hold one level of balanced parentheses (encyclopaedia URLs do).
const LINK = /^\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/;
const AUTOLINK = /^https?:\/\/[^\s<>()[\]]+/i;

const isWord = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? "";
    const prev = s[i - 1];

    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }

    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const open = "`".repeat(n);
      const close = s.indexOf(open, i + n);
      if (close !== -1) {
        let code = s.slice(i + n, close);
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        flush();
        out.push({ t: "code", v: code });
        i = close + n;
        continue;
      }
      text += open;
      i += n;
      continue;
    }

    if (ch === "*" || ch === "_") {
      const double = s[i + 1] === ch;
      const delim = double ? ch + ch : ch;
      // Underscores only emphasise at word boundaries: snake_case stays text.
      const boundaryOk = ch === "*" || !isWord(prev);
      const next = s[i + delim.length];
      if (boundaryOk && next !== undefined && next !== " " && next !== "\n") {
        let close = s.indexOf(delim, i + delim.length + 1);
        while (close !== -1) {
          const before = s[close - 1];
          const after = s[close + delim.length];
          const closeOk = before !== " " && (ch === "*" || !isWord(after));
          if (closeOk) break;
          close = s.indexOf(delim, close + 1);
        }
        if (close !== -1) {
          flush();
          const inner = parseInline(s.slice(i + delim.length, close));
          out.push(double ? { t: "strong", c: inner } : { t: "em", c: inner });
          i = close + delim.length;
          continue;
        }
      }
      text += delim;
      i += delim.length;
      continue;
    }

    if (ch === "[") {
      const m = LINK.exec(s.slice(i));
      if (m) {
        const href = safeHref(m[2] ?? "");
        flush();
        const label = parseInline(m[1] ?? "");
        if (href) out.push({ t: "link", href, c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }

    if (ch === "h" && !isWord(prev)) {
      const m = AUTOLINK.exec(s.slice(i));
      if (m) {
        // Trailing punctuation belongs to the sentence, not the address.
        const url = m[0].replace(/[.,;:!?'"]+$/, "");
        flush();
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }

    text += ch;
    i++;
  }
  flush();
  return out;
}
