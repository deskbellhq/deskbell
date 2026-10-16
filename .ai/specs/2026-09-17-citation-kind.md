# Citations carry their source kind

> Status: done · 2026-09-17

**Goal.** A citation pill says which page an answer drew on but not what kind
of source the page came from. With one connector that was moot; with a second
(a wiki beside a help centre, say) a visitor wants to see the difference at a
glance, and a host page wants to style the two apart. The engine already knows:
every chunk joins its document, and every document belongs to a source with a
`type`.

## Design

`ScoredChunk` gains `sourceType`, read through one more join in the pgvector
driver (both the single-query path and the hydration pass). The engine copies
it onto each citation as `kind`, and the ask route copies it onto the retrieved
set it stores with a refusal. `Citation.kind` is optional on the wire and in the
schema: rows stored before this exist and must keep parsing, and the replay
endpoint parses an array as a whole.

In the widget the pill's `part` becomes a list: `citation-pill` as before, plus
`citation-kind-<slug>` from the kind. A host page styles all pills with the
first and one kind with the second, including a `::before` label or icon. The
kind is also on the pill as `data-kind`. Clicking a pill emits
`deskbell:citation` with the href, document id and title.

## Non-goals

- A label per kind inside the widget. The kind is a connector id, not copy; the
  host page or a copy key decides what to call it.

## Verify

- Stored citations with and without `kind` parse; a citation missing a required
  field still fails the array.
- The retrieval join returns the source type on both paths (typecheck covers
  the shape; the fixture gate is unchanged since the in-memory store sets none).
- `styles.test` accepts a computed part list.
