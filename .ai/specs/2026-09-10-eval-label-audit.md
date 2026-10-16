# Record what retrieval returned, and audit labels against it

> Status: done · 2026-09-10

**Goal.** A report row currently says *whether* retrieval hit a case's labels
and *which* documents the answer cited, but not which documents retrieval
returned. That gap makes the commonest label defect invisible: a case scored
as a retrieval miss while the answer was graded correct is usually a **second
page that also supports the answer and is not labelled** — but nothing in the
report shows it, so the "miss" reads as a ranking failure and gets tuned
against. This change records the retrieved document ids per case and adds a
CLI that turns a report plus the corpus into a per-case label audit: which
labelled pages were and weren't retrieved, which unlabelled pages were cited,
and whether those pages actually contain the case's marking criteria.

## Design

**Report field.** `EvalCaseResult.retrievedDocumentIds: string[] | null` —
the top-*k* retrieved chunks collapsed to documents in rank order, using the
same collapse the retrieval metrics use (extracted as `rankedDocuments` in
`metrics/retrieval.ts` so the two cannot drift). Null when the target cannot
observe retrieval, matching `retrieval`. Ids only: the answer text stays out
of the report, as before. The baseline does not serialise it, so a baseline
diff cannot move because of it.

**Audit module.** `packages/evals/src/audit.ts`, imported lazily by the
script and never by `index.ts` — it needs the database, and the fixture path
must keep opening none. For every case with retrieval scores below full
recall it assembles one row per document that is labelled, cited or
retrieved, and for each row checks every `expectedFact` as a normalised
substring of that document's chunk text. The per-case verdict is derived
mechanically:

- `label-candidate` — an unlabelled cited document contains every criterion;
- `partial-candidate` — it contains the key fact but not all criteria;
- `ungrounded-correct` — graded A/B, yet no unlabelled cited document holds
  the facts (a groundedness finding, not a label gap);
- `retrieval-miss` — everything else: the labels are right and retrieval
  did not reach them.

The verdict is a prompt for a human, not a decision. A URL is added to a
case's labels only after someone reads the page and confirms it answers the
question — the substring check finds candidates, it does not certify them.

**Script.** `scripts/eval-label-audit.ts --report <json> --dataset <json>
[--project <id>] [--markdown <out>]`. Reads the report, resolves the
dataset's `relevantUrls` with the same normalisation the run used, loads
title/URL/chunks for the documents involved, and prints a Markdown audit.
`DATABASE_URL` selects the corpus, as for a `--project` run.

## Non-goals

- Editing the dataset. The audit reports; a person relabels.
- Recording retrieval scores or chunk text in the report.
- A grading UI. This is the smallest tool that makes relabelling
  evidence-based; an annotation surface is a separate piece of work.

## Open questions

- Whether `retrievedDocumentIds` should also appear in the Markdown report.
  Left out for now: the table lists only cases below full marks and stays
  scannable; the JSON carries the detail.

## Verify

- A target that reports retrieval yields `retrievedDocumentIds` in rank
  order with chunks of one document collapsed; a target that cannot observe
  retrieval yields null.
- `scoreRetrieval` numbers are unchanged after the helper extraction (the
  fixture gate stays green with no baseline change).
- The audit marks a fact present when it appears in any chunk of the
  document regardless of case or spacing, and absent otherwise.
- On a real report the audit lists every case with recall below 1 and no
  other.
