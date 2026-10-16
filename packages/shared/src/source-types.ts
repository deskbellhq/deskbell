/**
 * Source type strings that a browser needs by value.
 *
 * `./jobs` also exports these, but it imports zod for the queue contracts and
 * the widget bundles nothing from it (AGENTS rule 5). This module has no
 * imports at all, so the widget can read a constant without paying for a
 * schema library.
 */

/**
 * A source of answers written in the dashboard (spec: corrections-source).
 * Not a connector: nothing external to discover from, one row per project,
 * created the first time an answer is saved. A citation whose `kind` is this
 * string is a written answer and is labelled as one (spec:
 * answer-citation-labels).
 */
export const CORRECTIONS_SOURCE_TYPE = "corrections";

/**
 * A citation whose `kind` is this string points at a tool result rather than
 * a document (spec: mcp-actions): its `documentId` is `action:<call id>` and
 * its title is the tool's. The widget labels it as an action and never links
 * it.
 */
export const ACTION_CITATION_KIND = "action";
