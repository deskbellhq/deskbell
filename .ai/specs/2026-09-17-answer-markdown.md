# Render answers as Markdown

> Status: done · 2026-09-17

**Goal.** The model writes Markdown (the grounding prompt asks for lists and
code where they help) and the widget shows it as plain text in a `pre-wrap`
bubble, asterisks and backticks included. A numbered procedure or a shell
command is exactly the kind of answer a docs widget exists to give, and it
reads badly. This spec renders the subset of Markdown answers actually contain,
without adding a dependency and without ever turning model output into markup.

## Design

**A parser that emits a tree, and a renderer that emits vnodes.** No `innerHTML`
anywhere, so there is no sanitiser to get wrong: every string the model wrote
becomes a text node. `<script>` in an answer is the six characters, on screen.
Links are the one place model text becomes an attribute, and only `http`,
`https`, `mailto`, anchors and root-relative paths pass; anything else renders
as the link's label in plain text. Links open in a new tab with
`rel="noreferrer noopener"` and emit `deskbell:link` with the href, so a host
page can count them the way it counts citation clicks.

**Why not a library.** The two well-known parsers cost 12 to 15 KB gzipped and
emit HTML strings, which then need a sanitiser of 7 KB more. The whole widget
is 16.6 KB. An in-house parser for the subset below is under 3 KB and is safe
by construction.

**The subset.** Paragraphs; headings (levels 1 and 2 render as `h3`, deeper as
`h4`, because the answer sits under the panel's own heading); bullet and
numbered lists with one level of nesting and continuation lines; fenced and
inline code; block quotes; rules; strong, emphasis, links and bare URLs. A
single newline inside a paragraph is a line break, not a space: chat answers
use newlines to mean them. Underscores inside a word stay text, so
`snake_case` survives. Tables and images are out: tables need width the bubble
does not have, and an image is a network request to a host the model chose.

**Streaming.** Every token re-renders the bubble, so the parser must make sense
of a prefix. An unterminated fence is a code block to the end of the input; an
unmatched `**` is literal. Both settle as more text arrives. Parsing two
kilobytes takes microseconds, so tokens are not batched.

**Only answers.** The visitor's own messages, refusals and error copy stay plain
text. A refusal is copy the operator wrote, not model output.

**`answerTransform`.** A JS-only element property `(markdown: string) => string`
applied to the answer before parsing. It exists for presentation conventions
that belong to one deployment (a house style for numbered steps, say) and would
be wrong as a widget feature. It receives the streamed prefix on every render
and must be pure.

**Surface.** Two tokens, `code-bg` and `code-fg`, for the fenced-code block,
with light and dark defaults. Four parts, `md-heading`, `md-list`, `md-code`
and `md-link`. One event, `deskbell:link`.

## Non-goals

- Syntax highlighting. A language name lands on the block as `data-lang` so a
  host page can wire its own highlighter; the widget ships none.
- Tables, images, footnotes, task lists, raw HTML passthrough.
- A copy button on code blocks. Worth its own small spec once the block exists.

## Open questions

- Whether headings should carry ids for anchors. Nothing links into a bubble.

## Verify

- Parser tests: every block kind, nesting, continuation, the streaming prefixes,
  `javascript:` and `data:` links dropped, raw HTML kept as text.
- Render tests through `preact-render-to-string`: parts present, model text
  escaped, links carry `target` and `rel`, ordered lists start where the answer
  did.
- Widget unchanged for user bubbles, refusals and errors.
- `deskbell.js` gzip delta at most 3 KB. Done: 16.6 to 18.8 KB, a 2.2 KB delta.
