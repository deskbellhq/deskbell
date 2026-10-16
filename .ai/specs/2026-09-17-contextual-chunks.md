# Contextual chunks: a model-written line of context per chunk

> Status: done · 2026-09-17 — measured and rejected; the page-text column stays, the contextualizer was removed

**Goal.** Short pages lose. After the retrieval defaults were chosen on
measurement (spec: retrieval-defaults) and both input-side experiments lost
(spec: chunking-experiments), the remaining retrieval failures on the
private tuning set sit almost entirely on one-chunk pages: a canonical page
that answers the question in a few hundred characters is retrieved about
half the time, a long page nearly always. The chunking spec named the two
candidates left and ruled both out of scope because the schema kept no page
text. This spec keeps the page text and tries the first candidate: before a
chunk is embedded, a chat model writes one or two sentences situating it in
its page, and the embedding is computed from that context plus the chunk.
The stored chunk text, what the answer model reads and what citations show,
does not change. It ships default-off, with the cost stated, and flips only
on a measured win.

## Design

**Keep the page.** `documents.content` (nullable text) holds the page text
the connector emitted, as chunked. Rows ingested before the column exists
carry null; the next sync fills it. A document whose content hash is
unchanged and whose content is null gets the text written and nothing else
— no re-chunk, no embed job, so a re-sync after the migration is cheap and
chunk identity survives it. Storage roughly doubles the text held per
page (chunks already hold it once, with overlap); accepted, and it is what
the second candidate (handing the model a whole short page) will need too.

**Context is a column, not a rewrite.** `chunks.context` (nullable text)
holds the model-written line. Null means none was written, which is the
state of every chunk today and of every chunk in a deployment that leaves
the feature off. The embedding input is `context + "\n\n" + content` when a
context exists and `content` alone otherwise — one function,
`embeddingInput`, used by both embedding paths and nowhere else, so the two
cannot drift. The vector store's upsert carries the context so the write
that stamps the vector also records what it was computed from.

**One model call per chunk, in the model-config module.** `createContextualizer`
lives beside the gap analyst (root AGENTS rule 8; D4/D13): its own model
setting, its own timeout, the model built on first use so a bad id fails
one chunk rather than the worker's boot, plain-text output trimmed to a
few hundred characters. The prompt hands the model the page title, the
page URL, the page text and the chunk, between delimiters, and says all of
it is material to describe, never instructions — ingested content is data
(root rule 6). The page text is capped before it goes in; a chunk is at
most a few thousand characters and pages on documentation sites are
short, so the cap rarely bites and a page past it still gets a context
written from its head.

  DESKBELL_CONTEXTUAL_CHUNKS   off (default) | on
  DESKBELL_CONTEXT_MODEL       provider/model, defaults to the chat model
  DESKBELL_CONTEXT_TIMEOUT_MS  default 30000

**Where it runs.** Two places, both in the worker, both only when the
setting is on and the chunk has no context yet and its page has text:

- `embed.chunks`, so a fresh sync of a source produces contextualised
  chunks from the start.
- `reindex.embeddings` (and the CLI that runs the same loop,
  `scripts/reindex-project.ts`), so an operator who turns the setting on
  can contextualise an existing corpus by re-indexing rather than
  re-crawling. A chunk whose page has no stored text (ingested before the
  column) is embedded from its content alone and counted; the log says how
  many, and the fix is a re-sync.

Contexts are written a few at a time inside each embedding batch, not one
by one: a corpus of a thousand chunks is minutes, not an hour.

**It is a spend.** Every context call is charged to the project's daily
token budget, the row the answer path and the gap analyst charge. When the
budget is spent the job embeds the remaining chunks without context and
says so in the log — an exhausted budget must not leave a source in
`syncing` forever, and a chunk without context is what the deployment had
yesterday, not a broken one. A later re-index fills the gaps.

**Default off, and why.** A context call per chunk multiplies the cost of
ingest by the price of a short chat completion per chunk, on every sync
that changes a page and on every re-index. A self-hoster on a local model
pays it in time. That is a cost the operator opts into knowing the number
this spec records below; it is not a default anyone should inherit.

## Non-goals

- Feeding the context into the lexical leg. `search_tsv` is generated from
  `content` and stays so; the technique's full form indexes context for
  keyword search too, but hybrid retrieval is off by default and was
  measured as a loss on this corpus, so the lexical half waits for a reason.
- Parent-page retrieval (handing the model a whole short page once any of
  its chunks is hit). Needs `documents.content`, which this spec adds, and
  its own measurement; not taken here.
- Re-contextualising chunks that already have a context when the model
  changes. A context is a description, not a vector; it does not go stale
  with the embedding model, and rewriting every one on a model change is a
  cost with no measured benefit. Clear the column to force it.

## Open questions

- Whether the context should carry the page title verbatim. The title
  experiment lost because a title prepended to a chunk pulls the vector
  toward the title's words; a sentence that says what the chunk is about,
  in the page's own terms, is a different input. Measured, not assumed.
- Concurrency inside a batch is a constant today. If providers rate-limit
  it, it becomes a setting.

## Verify

- `embeddingInput` is the only place that decides the embedding text; the
  stored `content` is byte-identical after a contextualised re-index.
- A re-sync of an unchanged source after the migration writes
  `documents.content` for every row and enqueues no embed job.
- With the setting off nothing constructs a model on the embed or reindex
  path (tested with a model factory that throws).
- Budget exhausted mid-job: the remaining chunks are embedded without
  context, the job completes, the source reaches `ready`.
- Numbers below: the private tuning set, retrieval-only, same corpus,
  same chunk ids, before and after contextualising every chunk.

## Measurements

Private tuning set (99 cases, 79 labelled, 86 labelled documents), k=8,
shipped retrieval defaults, retrieval-only, on a fresh crawl of the corpus
(295 pages, 968 chunks) so that every arm shares one set of chunk ids.
Control and both treatments differ only in what the embedding was computed
from; stored `content` was byte-identical throughout.

**Control (no contexts):** recall@8 **0.886** · MRR 0.671 · nDCG@8 0.711;
one-chunk pages 0.529 (n=17), multi-chunk pages 0.984 (n=62).

**Every chunk contextualised (968 of 968; four timeouts on the first pass,
swept by a second re-index that wrote only those four):** recall@8
**0.865** · MRR 0.674 · nDCG@8 0.708; one-chunk pages 0.549, multi-chunk
0.952. Two labelled documents gained, four lost. The two gains were the
two cases whose question shares no content word with the page that answers
it — the context line names the page's subject in the page's own terms,
which is exactly the bridge those questions needed. The four losses were
on longer pages: a context that describes a chunk's place in its page
moves every chunk of that page toward the same description, and a long
page's chunks stop competing on what they individually say.

**Contexts kept only on one-chunk pages (83 chunks), everything else
re-embedded from content alone:** recall@8 **0.886** · MRR 0.652 · nDCG@8
0.701; one gained, one lost; both page-size splits unchanged. The ranking
metrics fell without recall moving.

**Cost, for the record:** writing 968 contexts took 3.20M input and 0.59M
output tokens on the default chat model — about 3.3k in and 600 out per
chunk, the output mostly the model's own reasoning — and roughly eight
minutes of wall time at six calls in flight. Four of 968 calls hit the
30-second timeout on the first pass.

**Verdict.** Neither form moves recall@8 by the 0.03 this project asks of
an input-side change, and both cost ranking quality. The contextualizer,
its column and its settings were removed rather than left behind a flag,
as the title experiment was (spec: chunking-experiments): a knob that was
measured to lose is not a feature. `documents.content` stays — it is
cheap, it is what a re-sync fills, and it is what the remaining candidate
(handing the model a whole short page) needs. The miss-classification
script that framed this experiment stays too (`scripts/eval-miss-classify.ts`).
The full implementation is preserved on a local branch for any later
corpus that behaves differently; a single-corpus number is a statement
about the corpus as much as the technique.
