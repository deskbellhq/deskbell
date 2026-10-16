# Ingestion pipeline: real re-indexing and injection flagging

> Status: implemented · 2026-08-24
>
> §1: reindex.embeddings is a real, resumable job (version-behind-target
> predicate), embed-chunks stamps versions, dimension changes are refused
> before any write, and the Sources page offers the re-embed when stored
> models diverge from the configured one. §2: heuristics in
> `packages/core/src/ingest/injection.ts`, `chunks.injection_signals` column,
> flagged counts per source in the dashboard. Verification notes at the end.
>
> Resolves `TODO(spec: ingestion-pipeline)`. Two promises the codebase already makes in
> writing and does not keep: the embedding re-index path that `packages/db/AGENTS.md`
> requires, and the ingest-time injection flagging that `packages/connectors/AGENTS.md` and
> the extractor's own header comment both mandate.

**Goal.** `reindex.embeddings` is a registered queue whose handler logs a job id and
returns; `chunks.embedding_version` exists, defaults to 1, and is never read or written by
anything. Separately, the extractor's header says instruction-like content "is NOT cleaned
here" because flagging lands later — and flagging never landed, so there is no column to
put a flag in and nothing to look at. Both are gaps between a documented contract and the
code. This spec closes them.

## Design

### 1. `reindex.embeddings` becomes a real job

Changing the embedding model invalidates every stored vector. `packages/db/AGENTS.md`
already forbids handling a dimension change with an in-place alter and points at this job
as the sanctioned path — a path that does not exist. Today the queue is a bare string in
the worker with no exported constant, no payload schema, and no producer anywhere in the
repo.

**Payload and registration.** Add `QUEUE_REINDEX_EMBEDDINGS` and a zod payload beside the
existing constants in `packages/shared/src/jobs.ts`, matching the shape the other two jobs
use:

```ts
{ orgId: string; projectId?: string; targetModel: string; targetVersion: number }
```

Omitting `projectId` re-indexes the whole org; supplying one scopes it. Every query is
org-scoped either way (D12).

**Handler.** New `apps/worker/src/handlers/reindex-embeddings.ts`, reusing the batching
already proven in `embed-chunks.ts` (`EMBED_SLICE = 64`, sized to sit under the embedding
API's own per-model batching).

- Select chunks whose `embedding_version` is **behind** the target, not chunks matching a
  flag. That predicate is what makes the job resumable: a crash mid-run leaves the
  completed rows advanced, and re-running continues rather than restarting.
- Write `embedding_model` **and** `embedding_version` on every row it touches.
- **Fix the same omission in `embed-chunks.ts`**, which writes `embedding_model` but never
  `embedding_version`. Without that, every freshly ingested chunk sits at the default and
  the reindex predicate cannot distinguish "new" from "current".
- **Refuse a dimension change rather than half-applying one.** The `embedding` column is
  `vector(1536)`; a model with different dimensions cannot be written into it, and
  discovering that halfway through leaves the corpus split across two vector spaces, which
  silently corrupts retrieval rather than failing. Detect and reject before writing
  anything, with an error naming the required migration.

**Throughput, stated because it will bite.** pg-boss runs with all defaults, so `batchSize`
is 1 and `localConcurrency` is 1 — every job in the system is strictly serial,
worker-wide. A full re-index therefore blocks all ingestion for its duration. Options are
to give `work()` explicit options for this queue, or to accept it and document it. Either
is defensible; leaving it undiscovered is not, because "my sources stopped syncing" after
a model change is a self-host support ticket with a non-obvious cause.

**Producer.** A dashboard action, so a self-hoster who changes `DESKBELL_EMBEDDING_MODEL`
has a supported way to act on it rather than a queue name found by reading the source.

**Not in scope:** `purge.conversations`, the other stub in the same registration block. It
is retention policy, not ingestion, and belongs with PII and retention work.

### 2. Injection flagging at ingest

`packages/connectors/src/docs-crawler/extract.ts` emits content as-is and says so; the
connectors' `AGENTS.md` says emitted content is untrusted and the rule is **flag, don't
clean**. Nothing flags. The only defence today is the system prompt telling the model that
context is data, never instructions — one layer, in the place most exposed to a
sufficiently persuasive document.

**Where the flag lives.** A column on `chunks`, added via drizzle-kit and the generated SQL
reviewed before committing, per `packages/db/AGENTS.md`. A narrow, queryable shape beats a
free-form blob: what the dashboard needs is "which chunks are flagged, and why".

**How flagging works.** Cheap heuristics, not a model call — this runs per chunk at ingest
scale, and a model call per chunk changes the cost of ingestion by an order of magnitude.
Target the shapes that only ever appear in an attack: imperative second-person instructions
addressed to an assistant, conversation role markers embedded in prose, and explicit
attempts to discard prior instructions.

**Flagging is not filtering, and this is the load-bearing decision.** A flagged chunk stays
retrievable and stays in the corpus. Dropping it silently deletes part of a customer's
documentation from their own answers on a heuristic's say-so, and the failure is invisible:
the answer is merely worse, with nothing to indicate why. Recording and surfacing is the
honest v1 — the operator can see what was flagged and decide.

What the engine should eventually *do* with the flag — down-rank it, fence it harder in the
prompt, or nothing — is deliberately unanswered here. Recording the signal is a
prerequisite for deciding, and deciding without data would be guessing.

The prompt-side defence stays exactly as it is. This is defence in depth, not a
replacement: an attacker who defeats the heuristic still meets the prompt boundary, and an
attacker who defeats the prompt boundary is now visible in the dashboard.

## Non-goals

Cleaning or rewriting ingested content. Dropping flagged chunks from retrieval. Model-based
injection detection. `purge.conversations`, retention, and PII redaction. Contextual
chunking. Connectors beyond the docs crawler.

## Open questions

- Should the engine act on the flag at all in this iteration, or only record it? Recording
  first is the position taken above; the argument for acting sooner is that a flagged chunk
  reaching the prompt is the whole risk.
- Should a reindex be able to run at lower priority than ingestion, rather than serialising
  ahead of it?
- Does a re-index need to invalidate anything downstream? Nothing caches answers today, but
  something will, and the invalidation hook is cheaper to design now than to retrofit.

## Verify

Unit (`pnpm test`):

- The flag heuristics fire on known injection shapes and stay quiet on ordinary
  documentation prose, including prose that merely contains imperatives ("click Save").
- The reindex predicate selects only rows behind the target version.
- A dimension mismatch is rejected before any row is written.

Manual, against a real Postgres:

1. Ingest a source, confirm every chunk lands with `embedding_version` set — not the bare
   default.
2. Enqueue a reindex to a new version. Confirm `embedding_model` and `embedding_version`
   both advance and answers still work afterwards.
3. Kill the worker mid-reindex and restart it. Confirm it resumes and does not re-embed
   rows already advanced.
4. Enqueue a reindex targeting a model with different dimensions. Confirm it refuses and
   writes nothing.
5. Ingest a page containing an injection string. Confirm the chunk is flagged, still
   retrievable, still usable in an answer, and visible in the dashboard.
6. Confirm ordinary documentation from the same crawl is not flagged.

Then `pnpm lint`, `pnpm typecheck`, `pnpm build`. Note that the Drizzle client is cached on
`globalThis`, so restart the dev server after the migration or new columns read back
`undefined` (`apps/web/AGENTS.md`).

**Verified live 2026-08-25**, driving the handlers directly against the dev corpus
(97 chunks, real Postgres, real embedding calls):

| Check | Result |
|---|---|
| Heuristic false positives across a real crawled docs corpus (checks 5b/6) | **0 / 97 chunks** |
| Dimension refusal — 3072-dim model into vector(1536) (check 4) | Refused before any write, error names the migration; state byte-identical after |
| Re-index to version 2 (check 2) | 97 chunks re-embedded, `embedding_model` + `embedding_version` advanced on every row |
| Immediate re-run at the same target (check 3, resumability half) | 0 chunks re-embedded — rows past the predicate are never touched again |
| Retrieval after the re-index (check 2, "answers still work") | 8 hits on a known-good question with sane ranking, floor off, default options |

**Mid-batch kill/resume verified live 2026-08-25** (check 3, kill half). Seeded 200 chunks
at version 1 in an isolated org, enqueued a project-scoped reindex to version 2, and
`SIGKILL`ed the worker process the instant the first batch committed (64 rows at v2, 136
still at v1). On restart, pg-boss re-delivered the same job and the resume re-embedded
exactly **136** chunks — the 64 already advanced were never touched — ending 200/200 at v2.
The job carried a short `expireInSeconds` so the orphaned active delivery was re-fetchable
while watching; production keeps the 15-minute default, same mechanism, longer clock.

**Poisoned page → dashboard badge walked end to end 2026-08-25** (checks 1 and 5a). A fresh
docs-crawler ingest of a three-page test site — one page carrying instruction-override,
role-marker, assistant-address and system-prompt-probe payloads — flagged exactly that
page's chunk (all four signals) and left the two ordinary pages ("click Save", "run the
installer", "restart the server") clean (check 6). The flagged chunk embedded, retrieved
(score 0.712) and was used in a real answer that ignored every embedded instruction (no
marker echoed, no prompt leaked). The **"1 flagged"** badge rendered on that source's row
in the Sources page in a browser.

Still fully outstanding: none of the ingestion-pipeline manual checks remain.
