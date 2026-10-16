# Written answers: the name and where they live

> Status: done · 2026-09-18

**Goal.** The source of answers typed into the dashboard shipped under the
name "Corrections". The name says something was wrong, which is one reason
to write an answer and not the common one: most are written for a question
the docs never covered. It also placed the feature where nobody looks — a
row in the websites table and a button in the page header. This renames the
feature to **written answers** everywhere a person reads it, and gives it a
place of its own: a child of Sources in the sidebar, a card on the Sources
page, a page at `/sources/answers`.

## Design

**One name.** "Written answers" in the sidebar, the command palette, the
Sources page, the page title and the docs. The verb is "Write an answer";
the edit form is "Edit answer"; a gap resolved by one is "Answered"; a
visitor sees "Written answer" on the citation pill. The internal source type
string stays `corrections`: it is stored in every project's `sources` row and
a rename would be a migration for a word nobody sees. File names that carry
`correction` (`lib/corrections.ts`, `components/correction-*.tsx`, the
`CorrectionForm` component) stay too, for the same reason: they are the
builder's names, and the user-facing strings are what changed.

**The tree.** Sources is the parent; written answers are one of its children
and the only one today. The sidebar's nested-item support renders the child
under the parent, the parent stays a link to `/sources`, and the parent is
highlighted for any `/sources/*` path while the child is highlighted for its
own. The command palette lists the child as its own entry so ⌘K reaches it
directly. The proxy matcher already covers `/sources/:path*`. These three
lists — sidebar, palette, matcher — must agree; a page in one and not the
others is a bug.

**The Sources page has two sections.** *Websites* holds the crawler form and
the table of crawled sites; the answers source is filtered out of that table
because a row with no URL, a fixed type and a "Manage" link in the URL
column answered none of the questions the table asks. *Written answers* is a
card: the count, how many are still indexing, when the last one was written,
a primary "Write an answer" button that opens the same drawer the management
page uses, "Re-index" as the outlined secondary action (the source sync,
which re-chunks every answer), and a "Manage" link to the page. Injection
flags on answer chunks show on the card as they do on a website row.

**The page.** `/sources/answers` replaces `/sources/corrections`. There is no
redirect: the old path was live for a day and nothing outside the dashboard
linked to it. The page title is "Written answers", the header action is
"Write an answer", and the empty state says "No written answers yet".

## Non-goals

- Renaming the source type, the database columns
  (`gap_clusters.correction_document_id`) or the job names. They are not read
  by people.
- More children under Sources. The nesting exists for this one page; a
  second kind of source gets a child when it exists.

## Verify

- The sidebar shows "Written answers" under Sources; on `/sources/answers`
  both the parent and the child are highlighted; on `/sources` only the
  parent.
- ⌘K lists "Written answers" and navigates to the page.
- The Sources page shows the websites table without an answers row and a
  card with the count, the indexing count and the last written time; "Write
  an answer" opens the drawer; "Manage" opens the page.
- No user-facing string in the dashboard says "correction".
- The browser suite: the card counts the seeded answer, the sidebar entry is
  active on the page, and the add, edit and delete round trip runs on the
  renamed page.
