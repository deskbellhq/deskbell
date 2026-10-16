# The gap drawer is URL state with a sticky action footer

> Status: done · 2026-09-18

**Goal.** The cluster's detail drawer was rendered inside each row and
opened by a click, which had two costs. Its actions sat under a long body,
so on a phone the thing to do was below the fold. And because the row
owned it, a row leaving the view took the drawer with it: resolving or
answering a cluster from the open view (spec: gaps-status-filter) would
have closed the drawer the operator was working in. This makes the drawer
one component per page, opened by the URL, with its actions in a footer
that stays put.

## Design

**Open means `?gap=<clusterId>`.** The page reads the cluster id from the
query string, loads that cluster's rows by id over all time — still scoped
to the org and project through the conversation join — and renders one
drawer after the table, keyed by the cluster id. The drawer is therefore
independent of the table's period and status: a cluster answered from the
open view leaves the table and stays in the drawer, where its status chip
flips to Answered when the page revalidates. `&write=1` opens it straight
into the form. Both parameters come from the one URL builder the page and
its toolbar already share, so a drawer view is a link like every other
view. The row's Details control is a link to that view, and the row menu's
"Write an answer" is a link to the writing view; the row owns no drawer and
no form. A row the worker has not grouped yet renders a disabled button
with a title saying why: a link inside a disabled button still navigates,
so it is a plain button on purpose.

**Closing is a navigation.** Close, Escape, the overlay and browser back
all end at the same view without `gap` and `write`. The component flips a
local `open` flag first, for the close animation, then replaces the URL;
the page re-renders without the drawer and the component unmounts.
Writing and cancelling replace the URL the same way, so a reload never
reopens a form the operator left, and saving drops `write` while keeping
`gap`.

**Layout.** Header: the question, a muted meta line with the status chip
(Open, Answered with a pen, Resolved with a check), the count, the
phrasings, and "Recurring since" when the cluster reopened; an icon-only
close at the top right. Body, scrolling: Answer (the text, or the form),
Analysis with its button in the section header, Phrasings, Evidence,
"Open latest conversation". Footer, with a top border and outside the
scroll: one primary — "Write an answer" or "Edit answer", or "Save answer"
while writing with a text "Cancel" beside it — one outlined secondary,
"Mark resolved" or "Reopen", and a kebab holding "Copy as eval case" and
"Open latest conversation". The right drawer keeps its width and the three
controls fit in it; on a phone the bottom sheet caps its height and the
body scrolls under the footer, so the primary action is in view before any
scroll.

**The form under an external footer.** The form gains an id, an `actions`
mode that renders no buttons, autofocus on the answer, and a pending
callback: a submit button outside a form cannot read the form's status,
so the form tells it. The footer's Save is a submit button targeting the
form by id.

## Non-goals

- Keeping the drawer open across a period or status change made from the
  toolbar. Those links drop `gap`; the drawer is a view of one cluster, not
  a panel that follows the table.
- Deep-linking to an unclustered row. There is no id to link to until the
  worker has grouped it.

## Verify

- Details is a link; clicking it puts `gap=` in the URL and shows the
  cluster; Close removes it; browser back closes it; a link with `gap=`
  opens it directly.
- `?gap=<id>&write=1` opens the form with the answer field focused; Save
  from the footer shows the answer, the saved line and the Answered chip,
  and drops `write`; the row has left the open view and is Answered on the
  resolved view.
- On a phone the primary footer button is in the viewport before any
  scroll.
- The written answers page links each answer to its cluster's drawer.
