# Answer rendering fixes: tables, the sources line, the step count

> Status: done · 2026-10-23

Three defects seen in answers that used MCP tools.

## Markdown tables render as pipes

Answers that compare several things (plans and their limits, for
example) come back from current chat models as GFM pipe tables. The parser has
no table block, so the widget shows the raw `| a | b |` lines and the
`|---|---:|` separator as a paragraph.

**Design.** A `table` block in `@deskbell/shared/markdown`: a header row, a
separator row (`---`, with `:` for alignment), then body rows until a line
without a pipe or a blank line. Cells are parsed inline. The block starts only
when the separator follows the header, so a sentence with a `|` stays prose and
a table still streaming its first line renders as a paragraph until the
separator arrives. Body rows are padded or cut to the header's width. The
widget renders it inside `part="md-table"`, a horizontally scrollable wrapper,
with borders from the existing border token.

## The sources line leaks into the answer

The model ends an answer with `SOURCES: 2, T1`. When it decorates the line
(`**SOURCES:** T1, T2`, `Sources: 3.`, a code span) the strict parser does not
recognise it: the line is shown as prose and, because nothing was named, the
citations fall back to every retrieved document. In tool-heavy answers those
documents are unrelated to what the answer said.

**Design.**
- The parser normalises the last line before matching: leading and trailing
  emphasis and code markers are dropped, the prefix is matched without regard
  to case, and a trailing period is ignored. The numbers grammar is unchanged
  (digits, `T<n>`, commas), so a prose line that merely starts with "Sources"
  is still prose.
- When nothing is named and tools ran in the turn, the citations are the tool
  results only. The retrieved set is the fallback for answers written from the
  documentation; an answer written from tool results under unrelated pages is
  the failure the fallback exists to avoid.

## "1 steps"

`activitySteps` is a single template. A new copy key `activityStep` (default
`{n} step`) is used when the count is one.

## Labels a host can show

Embedders matching an existing design need three pieces of text the widget
did not expose: a title over the thread rail, a count beside "Sources", and a
prompt in front of the feedback buttons.

- `sidebar-head` and `sidebar-title` parts. The title shows `copy.threads` and
  is hidden by default (the rail's aria-label already names it); a host turns
  it on with `::part(sidebar-title)`.
- `citations-label` part, and `copy.sources` accepts `{n}`, the number of
  sources shown. The default stays "Sources".
- A `feedbackPrompt` copy key (default empty) rendered as a `feedback-label`
  part before the thumbs.
