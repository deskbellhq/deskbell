# Attention inbox

> Status: in progress · 2026-10-26

**Goal.** A thread carries several kinds of fact — how the answer went, what the visitor meant, what the visitor needs — and the inbox was showing them as one kind of badge. This unit gives each kind its own slot and one way to filter on all of them, so a reader never has to work out whether "uncertain", "downvoted" and "pushback" are the same sort of thing.

## Design

**Three slots, one colour.** A thread row and a thread header answer three questions in three places:

1. *How did the answer go* — the thread status (`lib/thread-status.ts`: certain, uncertain, unanswered). It is the only thing on the page with a status colour: a filled disc in `--certain` or `--uncertain` at the head of the row, a hollow ring for unanswered, the same marks the status badge and the Overview chart use. Nothing else is ever drawn in those hues.
2. *What the visitor meant* — topic and intent (spec: question-topics, intent-and-signals). Descriptive, so monochrome: plain outline pills in one "About" line on the thread header, never on the row.
3. *What the visitor needs* — a thumbs-down, a question that asked for a person, a question that pushed back. These ask a person to read the thread, so they share one trailing slot on the row: small muted glyphs with the rule as the tooltip, at most the three, no colour. The thread header lists them in one "Needs" line. Frustration is tone, not a to-do; it stays on the question's own badge in the transcript.

**One filter model.** The list's URL state (`lib/conversations-view.ts`) drops the three-way `filter` segment for a quick view and a set of narrowings:

- `view=all` (default) or `view=attention`: the two quick views above the list, each with its count for the period. "Needs attention" is a thread that is uncertain, downvoted, or has a question asking for a person or pushing back — the union of everything the row's colour and glyphs mark.
- `outcome=certain|uncertain|unanswered`, `feedback=down|up`, `intent=`, `signal=`, `topic=`, `ctx.<key>=<id>`, `user=`: each a chip above the list with a way back, each added from one **+ Filter** menu that lists the properties and their values. The menu offers what the project knows: the fixed outcome, feedback, intent and signal lists; the project's topics; the context keys and the ids seen on its conversations, named the way the host named them. A verified visitor arrives only through a link from the Usage page, since there is no list to pick from.
- `filter=uncertain` and `filter=down` keep working as aliases of `outcome=uncertain` and `feedback=down`, so links already written stay valid; new links are never written with them.

Every narrowing is a `HAVING` predicate over the same per-thread aggregates the list, the counts and the index page already share (`lib/conversations-list.ts`), so the row a filter lists and the count it shows cannot disagree. The chips on this page and on the Usage page render from one component so a filter looks the same wherever it appears.

**Usage page.** Topics, Intent and Signals move under one heading, "What visitors ask", placed under the chart and above the breakdown and visitors tables: what people ask outranks who asks, and the visitors table is empty for every deployment without verified identity. The group's heading carries the three shares worth acting on — requests, wants a human, pushback — each against every question in the period, with the change in points against the period before, each a door into Conversations. The three tables stay stacked and visible at once; a tab would hide two of them for the one reader who wants to compare.

**Overview.** The Conversations card's badge becomes a door: "N need attention", linking to the attention view, computed by the same count the inbox shows. The week's delta moves into the card's detail line. No fifth card: the grid is four, and a number that is a door belongs where the Answer-rate card already puts one.

## Non-goals

- Saved or named filter sets. Two quick views cover what is asked for today; a third view is a URL anyone can bookmark.
- Colour for intents, topics or signals. The series palette belongs to the Usage charts, where it means "which series", and would mean something else here.
- A combined "health" score per thread. The three slots are kept apart on purpose.

## Verify

- Unit: `conversations-view.test.ts` (quick views, the new narrowings, the legacy aliases, round-trips); `conversations-list` predicates are exercised by the browser suite.
- Browser: the row shows the disc and the glyphs the seed implies; the quick views carry counts and the attention view lists exactly the marked threads; **+ Filter** adds a chip and narrows the list; a legacy `?filter=down` link still opens the downvoted threads; the Overview card's badge links to the attention view with the same number.
