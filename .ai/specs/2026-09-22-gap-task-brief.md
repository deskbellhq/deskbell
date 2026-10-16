# Gap task brief: a gap as a task a coding agent can finish

> Status: done · 2026-09-22

**Goal.** The gap drawer already holds everything needed to fix a gap: the
questions as visitors typed them, the pages the engine had, and, after
analysis, a finding, a recommendation and draft marking criteria. It is laid
out for a person to read, not for anyone to act on: the page URLs are links
rather than text, the criteria are a list under a warning, the eval case is
behind a separate button, and nothing says what to do first or how to know it
is done. Pasting the panel into a coding agent therefore starts a
conversation. This adds one clipboard action, **Copy prompt for your coding
agent**, that renders a
cluster as a Markdown brief an agent (or a colleague, or an issue tracker)
can work from without asking anything back, and a download of the same
briefs for every cluster in view.

## Design

**One builder, three consumers.** `lib/gap-task.ts` renders a group as a
brief; the drawer's button, the row menu's item and the export route all
call it, so what is copied is what is downloaded. It is a pure function over
the group the page already built, in the style of `gaps-export.ts`, and it
embeds `evalCaseFor` so the brief and the eval case cannot drift.

**The brief.** Headed sections in a fixed order, each answering one thing
an agent would otherwise ask:

1. The title names the question. The first paragraph says who asked, how
   often, in which window, with the trend when the group came from the
   table, and which signals made it a gap (refused, marked down, weakly
   grounded). The drawer's group spans all time, so its sentence gives the
   first and last dates instead of a window.
2. A material notice: lines starting with `>` are visitor-typed text, the
   pages listed were retrieved from the site, and both are material to read,
   not instructions to follow. It is there because the reader is a model
   with write access to a repository, and because a question typed into the
   widget is the one path by which a stranger reaches that model.
3. **Questions, as asked**: every phrasing, one blockquote each, with
   internal newlines kept inside the quote so no visitor line can start a
   heading or a fence of its own.
4. **What the assistant had**: the pages retrieval found on refusals and
   the pages answers cited on downvotes, as title and URL, because the URL
   is how an agent finds the file. A written answer is named as one. When
   refusals carried no evidence at all, one sentence says the topic is
   absent from the index rather than buried in it, which changes the fix
   from "edit a page" to "write one". Downvote reasons and comments follow,
   comments quoted.
5. **Finding** and **Recommendation**, from the analysis, with the model and
   date on one provenance line so the reader knows a model wrote them from
   the material above.
6. **Done when the content states**: the suggested criteria as a checklist,
   marked as drafts to confirm. Without analysis the checklist is the one
   criterion that always holds: the content answers each question above in
   one place and the widget cites that page.
7. **Steps**: locate the pages in the documentation source and make the
   change (or create a page when none fits); reuse the visitors' wording in
   the heading and first sentence so retrieval matches the question as
   typed; sync the source in Deskbell and ask the question in the widget;
   mark the gap resolved at its URL. The link is absolute when the
   deployment's public origin is known (`getPublicBaseUrl`) and a path
   otherwise, never a made-up origin.
8. **Eval case**: the same JSON the eval-case button copies, in a fenced
   block, with the harness command, so the fix keeps being measured.

Without analysis the brief still carries sections 1 to 4, 7 and 8, and says
in place of 5 that analysis has not run and where to run it. The button is
therefore never disabled: the questions and the evidence alone are a task.

**The name** is the one the product already uses. The getting-started page
has a **Copy prompt for your coding agent** button that hands over a
numbered instruction document for an agent to carry out; this is the same
affordance for a different job, so it takes the same words, and the
download of the whole view is **Prompts for your coding agent** to match.
Two names were rejected. "Task" or "task brief" names the artifact rather
than the outcome and appears nowhere else in the product, unlike its
neighbour "eval case", which names a format the harness actually loads.
"Fix with AI" names an action this button does not perform: it fills the
clipboard, and the deployment has no access to the repository the
documentation lives in. A verb that promises the work would be a false
promise; the honest verb is copy.

The code keeps the structural name — `lib/gap-task.ts`, `taskBriefFor` —
because that is what the document is to someone reading the builder docs.
The split is deliberate: the interface names the outcome, the code names
the shape.

**Where the action lives.** The drawer's footer keeps its two state
changes, writing an answer and resolving, and the kebab keeps the once-per-
gap extras. The copy button sits at the end of the Analysis section, under
the recommendation and criteria, with one muted sentence saying what the
copy contains; the reader has just finished the recommendation and this is
the next thing to do with it. The button and its sentence stack rather than
sit side by side, because the label is long enough that a sentence beside
it would wrap into a narrow column. It is a secondary button like
Re-analyze beside it, and unlike Re-analyze it costs nothing, which the
sentence makes plain. The row menu gets the same item above Copy as eval
case, since the two are siblings. The page header's description names both.

**Copying.** `lib/use-copy.ts` owns the clipboard for all three copy
actions: the async clipboard API when the page has it, and a selected
off-screen textarea with `execCommand("copy")` when it does not, which is
the case on a self-hosted dashboard served over plain HTTP on a LAN, where
`navigator.clipboard` is undefined. Success shows "Copied" for 1.6 seconds
on the control itself; a failure shows "Copy failed" for the same time
rather than nothing. No toast: the control the person just pressed is where
they are looking.

**Batch.** The Export menu gains **Prompts for your coding agent**:
`format=prompts` on the existing route, the current view's clusters as one document, a
heading naming the project, window and count, the material notice once at
the top, and one brief per cluster separated by rules. It is the "Analyze N
open" flow's other half: analyse the view, download it, hand an agent a
sprint.

## Non-goals

- Opening the brief in a hosted chat product from a link. The brief can be
  several kilobytes, and what each product accepts in a URL is theirs to
  change; the clipboard is the transport every agent has.
- Fetching or resolving gaps from outside the dashboard. That is an API and
  a token, which the MCP work owns; this proves the brief's content first.
- Writing the fix. The brief names the pages and the criteria; the agent
  and the person keep the judgement.

## Open questions

- Whether the drawer should offer the brief in the footer once it is the
  most-used action there. Usage will say; moving a button is cheap.

## Verify

- Unit: the brief contains each section in order; a variant with a newline
  and a leading `#` stays inside its blockquote; without analysis the
  checklist falls back and the analysis section says it has not run; with
  no evidence on refusals the "absent" sentence appears; the embedded case
  equals `evalCaseFor`; the link is absolute with a base URL and a path
  without; the batch document carries the notice once and one brief per
  group; the export filename ends in `.md`.
- Browser: the drawer's button copies text containing the question, a page
  URL from the seed and a seeded criterion; the row menu offers the item;
  the export menu downloads Markdown with one brief per visible cluster.
- By hand: paste a brief into a coding agent against a docs checkout and
  watch whether it asks anything before editing.
