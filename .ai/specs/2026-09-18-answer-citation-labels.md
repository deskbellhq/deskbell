# Written answers are labelled as such in citations

> Status: done · 2026-09-18

**Goal.** A citation pill names the document an answer drew on. For a
crawled page that is the page title, and a page title says where the answer
came from. A written answer's document title is the question it answers, so
its pill echoes the visitor's own question back at them and says nothing
about provenance. Every citation already carries its source type on the
wire (spec: citation-kind); this makes the widget and the dashboard say so
when that type is the written-answers source: a pen glyph and a second line
reading "Written answer" under the title.

## Design

**One fact, two producers, several consumers.** The fact is
`Citation.kind`, copied verbatim from the retrieved chunk's source type by
the engine and by the ask route's refusal evidence. The engine emits no UI
string: it does not know what a kind is called (D10). Consumers compare the
kind to the written-answers source type and decide what to show. Rows
stored before the field existed have no kind and render as they did — the
title alone.

**The constant without zod.** The widget imports `@deskbell/shared`
type-only on purpose: a value import of the queue contracts would pull zod
into a bundle that ships on every host page. The source type string now
lives in `@deskbell/shared/source-types`, a module with no imports, exported
under its own entry the way `widget-config` is; the queue module re-exports
it so server code changes nothing.

**Widget.** Both pill branches — link and span — render one `PillBody`. For
a written answer it is a two-column inline grid: a 14 px inline pen glyph
spanning both rows, the title, and a second line in the muted text token
carrying the `writtenAnswer` copy key (default "Written answer") and the
`citation-label` part. Pages stay title-only; the pill for a page renders
exactly what it did before. No new theme token: the muted text token is
what a secondary line is for. Cost: a few hundred bytes gzipped against a
40 KB budget.

**Dashboard.** `lib/citation-label.ts` holds the one comparison and the one
text form (`written answer: {question}` for CSV cells, where a page is its
URL). The thread page's message pills and "Sources cited" list, the gap
drawer's evidence lists, the gaps table's evidence badges, and the CSV
export's evidence columns all use it. Evidence tallied from citations keeps
the kind so those surfaces can tell.

## Non-goals

- Using the kind in ranking. Retrieval still does not know the difference.
- A synthetic URL for written answers so a pill can be a link. There is
  nothing to link to; the answer is the text the assistant just gave.
- A label per connector type. Pages of any connector are titles; the host
  page can style `citation-kind-<type>` parts if it wants more.

## Verify

- Engine: a chunk with a source type yields a citation with that kind
  verbatim; a chunk without yields none.
- Widget: a written-answer citation renders a span with the glyph and the
  label part; a page citation renders a link with the title alone
  (`panel.dom.test`). `styles.test` finds the new part in the panel source.
- Dashboard: the CSV names a cited written answer as one; the thread page
  for a message citing both a page and a written answer labels only the
  written answer (browser suite).
- The widget bundle stays under budget; the generated parts reference lists
  `citation-label`.
