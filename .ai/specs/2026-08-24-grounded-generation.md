# Grounded generation: multi-turn context, honest citations, no silent floor

> Status: implemented · 2026-08-24 — §1 (interfaces), §2–3 (history, query planning),
> §4 (citations), §5 (retrieval floor: off by default, `DESKBELL_RETRIEVAL_MIN_SCORE`)
> and §6 (providers: anthropic chat, ollama chat + embeddings via the official
> OpenAI-compatible provider). Outstanding manual checks are listed under Verify.
>
> Resolves `TODO(spec: grounded-generation)` at `packages/core/src/engine.ts`. Covers the
> four defects in the answer path that do not need a benchmark to know they are wrong.
> Retrieval quality itself is deliberately out of scope — see
> `2026-08-24-hybrid-retrieval.md`.

**Goal.** The engine answers every question as if it were the first one asked, cites every
chunk it retrieved rather than the ones the answer used, refuses before the model is
consulted whenever a hardcoded similarity floor rejects everything, and supports exactly
one model provider despite an architecture built for any of them (D4, D13). Each of those
is wrong on its own terms. This spec fixes them and adds the test seam the package has
never had.

## Design

### 1. Interfaces and the test seam

`packages/core` has no tests, no vitest dependency, and no fake `EngineDeps` — so the
`NO_GROUNDING` state machine, which is load-bearing for every refusal, is unverified.

```ts
export interface Turn {
  role: "user" | "assistant";
  content: string;
}
```

- `AskInput` gains `history?: Turn[]`.
- `EngineDeps.generate` opts gain `history?: Turn[]`.
- `EngineDeps` gains `planQuery?: (input: QueryPlanInput) => Promise<QueryPlan>`.

All three are **optional**: an engine constructed as it is today keeps today's behaviour,
and no existing caller breaks.

Whatever double is used must be able to yield the refusal sentinel **split across tokens**
(`"NO"`, `"_GROUND"`, `"ING"`), because that is the case the buffering exists for and the
one a naive fake would never produce.

**Amended after the fact.** This first landed as an exported `src/testing/fake-deps.ts`, on
the reasoning that the eval harness would otherwise build a second double. That reasoning
was wrong — the harness drives a real `AnswerEngine` through its own `Target` interface and
never needed a fake `EngineDeps` at all. Nothing imported it, so it was a public subpath
with no consumer, and it was removed when the two efforts merged. The double now lives as a
local factory in `engine.test.ts`, which is the house style anyway: small local factories,
plain object literals, no mocking library, test names that state the consequence. See
`apps/web/lib/abuse/rate-limit.test.ts`.

### 2. Conversation history reaches retrieval and the model

Today `AskInput.conversationId` is used only to echo back in the `done` event. Both turns
are persisted and the widget replays the thread, so the conversation *looks* multi-turn
while every answer is computed from a single message. A follow-up like "and how do I
configure it?" reaches retrieval as those five words; "it" refers to nothing, and the only
remaining signal matches anything procedural.

Two separate consequences, and fixing only one is what makes this subtle:

- **The model has no context.** Fixed by passing prior turns to `generate`.
- **Retrieval has no context.** Not fixed by the above. The embedded query is still the
  bare fragment. This is the half that produces confidently wrong answers with unrelated
  citations, and it needs the question resolved *before* it is embedded.

**Loading turns.** No last-N helper exists; the unlimited `findMany` is duplicated in
`apps/web/app/api/v1/conversations/messages/route.ts` and
`apps/web/app/(dashboard)/conversations/[id]/page.tsx`, and `parseCitations` is duplicated
with divergent return types (`Citation[] | null` vs `Citation[]`). Add
`apps/web/lib/conversation.ts` exporting `loadRecentTurns(db, {orgId, conversationId,
limit})` and a single `parseCitations`, and move both existing sites onto them.

It lives in `apps/web/lib`, not `packages/core`: core does not touch the database (D10).
History arrives at the engine as data.

Default window: 6 turns. Long threads must not grow the prompt without bound, and the
resolution step below only needs enough to resolve a reference.

### 3. Query planning

A new `packages/core/src/retrieval/query-plan.ts` defines the contract; the implementation
is injected through `EngineDeps.planQuery` and constructed in `src/models/index.ts`, the
only module permitted a provider SDK (D4, D13).

```ts
export interface QueryPlan {
  /** The question made self-contained. Also the scoring query downstream. */
  canonicalQuestion: string;
  /** Searches to run. The canonical question always occupies the first slot. */
  queries: string[];
}
```

The planner does two jobs, and they are independent:

- **Resolve** — rewrite a fragment into a standalone question using prior turns. Needs
  history.
- **Expand** — produce additional searches that differ *in kind*: product vocabulary, plain
  language, the prerequisite step. Does not need history.

Conflating them is a trap worth naming: gating the whole planner on "is there history?"
leaves first turns — the most common path — retrieving from a single raw query, which is
the weakest retrieval in the system. Resolution is also what normalises a typo, which a raw
query never does.

Rules the implementation must hold:

- **It may never fail.** Any error, timeout, or malformed response falls back to searching
  the question as asked. A planner outage degrades answer quality; it must not degrade
  availability.
- **The canonical question takes the first query slot** — it is the one query guaranteed to
  be a faithful reading of what was asked — so ask for `n-1` variants, not `n`.
- **Variants must not be rewordings** of the canonical question. It is searched anyway, so
  a paraphrase spends a search slot twice.
- **State the count in the prompt prose, not only in the schema.** Structured-output
  validation enforces types and required keys but ignores array length bounds, so a
  schema-only cap silently overruns; the overflow is paid for and discarded. Log an
  overrun rather than trimming in silence.
- **Anchor the resolution instruction with a worked example.** A constraint stated as a
  rule is reliably ignored; the same constraint carrying one worked rewrite holds. Pin the
  constraints the schema cannot express with a test.
- **Do not append the product or brand name to queries.** It matches every document in a
  single-product corpus and dilutes the lexical half of a hybrid search.
- Domain vocabulary belongs in the prompt, or variants drift out of the product's language
  and retrieve the wrong nouns. **Deskbell cannot supply it.** The technique assumes one
  known product; here every project is somebody else's corpus with its own nouns, and the
  one term we do know — the project's name — is the one thing the rule above forbids
  injecting. So the prompt asks for "the wording the product's own documentation would use"
  and leaves the model to infer it. A per-project glossary, or one derived from the corpus,
  is the real answer; see `## Open questions`.

**Model construction is lazy, and that is load-bearing.** Building the planner model when
the deps are constructed would throw out of `createEngineModelDeps` for an unsupported
provider id — failing *every* answer, including first turns that never plan, over a setting
that is only ever meant to cost quality. Built inside the call, a bad id is a planner error
and the engine falls back. Pinned by a test that refuses to let a model be constructed on
the first-turn path at all.

**Configuration.** `DESKBELL_QUERY_PLANNING` = `followups` (default) | `always` | `off`.
`followups` plans whenever there is history — the case that is broken today. `always`
extends expansion to first turns; it is the higher-quality setting and costs one extra
model call on every question, so it stays opt-in until there is a measurement to justify
the latency. `off` restores today's behaviour exactly.

`DESKBELL_PLANNER_MODEL` selects the planner model, defaulting to the chat model. Keeping
it separate means changing the model that writes answers cannot silently change how
questions are resolved.

**Not in this spec:** actually *issuing* the extra queries. The plan is produced and the
canonical question is searched; pooling several result sets is a retrieval change and
belongs with the retrieval work, which can measure it.

### 4. Cite what the answer rests on

Context blocks are already numbered `[1]…[n]`. The `citations` event currently fires
*before* generation carrying every retrieved chunk, so an answer built from two chunks
displays up to eight sources. Retrieval order says nothing about how well any document
answered the question, and a correct answer under four unrelated links reads as
untrustworthy — which is the precise failure this project exists to avoid (D8).

The model names the blocks it used, and the engine cites only those.

**Implemented as a trailing line, not inline markers — a deliberate departure from the
first design here.** Inline `[n]` markers were the plan and they are wrong for this corpus:
a stripper that removes `[1]` from streamed prose also removes `matrix[1]`, `argv[0]` and
the label half of a markdown link. Deskbell's subject matter is documentation, much of it
about code, so an inline stripper is a false-positive machine aimed precisely at the
content it exists to serve.

Instead the answer ends with a strict final line — `SOURCES: 2, 5` — parsed off and never
shown. Two properties make that safe: only the FINAL line is ever a candidate, so no
character of the body is touched; and the parse accepts digits and commas only, so a page
ending "SOURCES: see the appendix" fails it and is emitted as the prose it is.

This is a **second** hold over the stream rather than an extension of the sentinel's, and
the plan to reuse one state machine was wrong. They are anchored at opposite ends: the
sentinel hold starts held and releases the moment the text stops matching, while the
sources hold cannot resolve until the stream closes. Forcing them together would produce a
worse version of both. They compose instead — the sentinel releases into the sources
filter — and are tested apart.

The cost is real and accepted: per-claim provenance is gone. Nothing rendered it, so
nothing is lost today, and inline markers can be layered on later behind a real renderer.

**Citations now arrive after the answer, not before.** They have to — which sources an
answer used is not knowable until the answer exists. The widget renders citations per
message and replaces on the event, so pills appear with the finished answer rather than
above a still-typing one. Arguably better, but it is a visible change.

**Fall back when the model names nothing.** An answer under no sources looks broken, which
is worse than an answer under too many. If the model omits the line, or every number in it
is out of range, cite the retrieved set — the old behaviour. Both paths are tested, and
out-of-range numbers are dropped rather than trusted, so an invented `[9]` over eight
blocks cannot reach past the array.

**Order and dedupe.** Keep the model's order, dedupe by `documentId`. No score-distance
threshold here: a relative cut-off is the right shape, but its thresholds have to be
calibrated against a real corpus, so it belongs with the retrieval work.

`ScoredChunk.score` is populated by the pgvector driver and currently **read nowhere** —
the engine maps hits to citations in retrieval order and ignores the value. This is its
first consumer, which also means the retrieval work is free to redefine the scale later
without breaking a caller.

**Two adjacent defects, fixed here because this is the code:**

- The ask route stores `citations: refused ? null : citations`, discarding retrieval
  evidence on exactly the answers most worth debugging — and refusals are the raw material
  for docs-gap analytics. Store them; keep the display decision on the client.
- The route assigns `messageId` *before* the insert, so a failed insert still emits a
  `done` event naming a row that does not exist, and feedback against it fails. Clear it in
  the catch.

**Compatibility.** Adding an *optional* field to `Citation` is safe. Adding a **required**
one is silent data loss: `parseCitations` runs `CitationSchema.array().safeParse` and
returns `null` for the entire array if any element fails, so every historical message would
lose its citations with no error. Any change to `Citation` must be optional.

### 5. The retrieval floor stops costing answers

`similarity > 0.3` is hardcoded in the pgvector query, and zero hits refuses before the
model is consulted. This is a **retrieval** floor — the only thing in the system that can
turn an answer into a refusal.

The distinction that matters: a retrieval floor decides *whether we answer*, and a citation
floor decides *whether a link is shown*. Correct documents routinely score poorly, so
cutting wrongly on the first costs the user their answer, while cutting wrongly on the
second costs a link. They are not the same control and must not share a threshold.

- Move it to `QueryOptions`, plumbed from configuration, **defaulting to off**. The
  `NO_GROUNDING` contract is the grounding gate; a similarity cut-off calibrated against
  nothing is a blunt second one.
- Zero *rows* still refuses. Zero rows *above a threshold* no longer does.
- Name and document the knob so it does not read as a quality dial — raising it trades
  answers for silence.

What the default value should be, if it is ever non-zero, is a question for the eval
harness. This change makes it visible and configurable instead of silent.

### 6. Model-agnostic in fact, not only in shape

`languageModel()` and `embeddingModel()` throw for any provider but `openai`. The
architecture is correct — provider SDKs are confined to the model-config module, which is
what D13 guarantees — but the capability is not demonstrable, and a local model is the
first thing a reader will try.

Add `anthropic` and `ollama` cases. Ollama carries the most weight: it is the one that
demonstrates running entirely on the operator's own hardware without a hosted key. It is a
service the operator already runs and is **not** added to `docker-compose.yml`, so the
Postgres-only self-host bar (D11) is unaffected.

## Non-goals

Hybrid retrieval, reranking, multi-query pooling, answer caching, cross-language retrieval,
inline clickable citation markers in the widget, `purge.conversations`, and any change to
the widget bundle.

## Open questions

- Should `AskInput.locale` reach the prompt or retrieval? It is accepted by the request
  schema and passed by the route today, and then used by nothing.
- Inline citation markers rendered as links need a render-time tokenizer, a numbered pill
  list, and a stable index contract between the context numbering and the deduped display
  list — all inside the widget's 40KB budget. Worth its own spec.
- Whether the 6-turn history window should be configurable, or whether a fixed window is
  the better promise to make about prompt size.
- **Where per-project vocabulary comes from.** The planner writes better searches when it
  knows the corpus's nouns, and a multi-tenant product cannot hardcode them. Candidates: a
  glossary field on the project, or terms mined from the corpus at ingest. Until then the
  planner infers from the question alone, which is the weakest part of the prompt.
- The planner writes search variants that are not yet issued — retrieval still runs one
  search. They are produced now so the contract settles once and so there is real data on
  whether the planner writes good ones before retrieval depends on them. If they turn out
  to be poor, that is cheaper to learn from a log than from a regression.

## Verify

Unit (`pnpm test`, runs in CI):

- The refusal sentinel is caught when it arrives split across tokens, and text that merely
  begins with a prefix of it is not swallowed.
- Marker stripping removes markers from streamed text and selects the marked citations.
- No markers emitted → fallback citation set, not an empty one.
- Planner throws / returns malformed output → the question is searched as asked and the
  answer still streams.
- Planner prompt holds the constraints the schema cannot express.
- `loadRecentTurns` respects its limit and returns oldest-first.

Manual, against a real Postgres — CI has no Postgres service, so this follows the precedent
set by `apps/docs/content/docs/security.mdx`.

**§2–3 verified 2026-08-24** against a 50-document / 97-chunk corpus. The controlled
comparison is the useful part, because it separates the two halves of the defect:

| Run | Same thread? | Planning | Result |
|---|---|---|---|
| "How do I add a data source?" | new | on | Grounded answer |
| "and how do I remove it?" | **yes** | on | **Grounded deletion instructions**, relevant sources |
| "and how do I remove it?" | no (cold) | on | `no_grounding` refusal |
| "and how do I remove it?" | **yes** | **off** | **`no_grounding` refusal** |

The last row is the one worth keeping. With planning off the model still receives the whole
conversation, and the answer is *still* a refusal — because retrieval searched the raw
fragment and found nothing. History in the prompt does not fix a follow-up on its own;
resolving the question before it is embedded is what does. Anyone tempted to drop the
planner as redundant should reproduce that row first.

Also verified: with `DESKBELL_PLANNER_MODEL` set to an unsupported provider, a first turn
answers normally (no planner call is made) and a follow-up answers degraded — one
`query planning failed` line in the log, retrieval falls back to the question as asked, and
the endpoint stays up. Availability survives a planner outage, which is the contract.

**§4 verified 2026-08-24** against the same corpus, with a real model:

| Check | Result |
|---|---|
| Citations per answer, four questions | **1–3**, where retrieval returns up to 8 |
| Sources line leaking into answer text | none, on any question |
| Event order on the wire | 84 `token`, then `citations`, then `done` |
| Refusal with hits → evidence stored | **6** and **2** citations, where the old code stored `null` |
| Refusal with no hits → evidence stored | empty array, correctly distinguishable from null |
| Spurious refusals introduced | none |

On the fixture, citation precision moves **0.444 → 1.000** with recall unchanged at 1.000,
and factuality and uncertainty both unchanged. Read that number with its caveat: the
fixture's generator is extractive, so it cites by construction and what moved is the
plumbing. The four-question run above is the behavioural evidence.

**§5 partially verified live 2026-08-25:** with the floor off (the new default), a
question against the dev corpus returns the full limit of 8 hits whose TOP score is
0.446 — worth reading twice: on this corpus the best answer to a perfectly answerable
question scores under 0.45, so marginal-but-correct documents sat within reach of the
old 0.3 cut. The model-side half (a weak-match question ending in an answer or an
honest model refusal, in a browser) is still open below.

**§6 verified live 2026-08-25** — a grounded answer on each new provider, driven against
the 97-chunk dev corpus with the chat provider under test and embeddings held on
`openai/text-embedding-3-small` (a query vector must share the space its corpus was
embedded in):

| Chat provider | Result |
|---|---|
| `anthropic/claude-haiku-4-5-20251001` | Grounded answer, 1 citation, real usage 4732 in / 226 out; embedding 8 tokens on openai; no refusal |
| `ollama/llama3.2:1b` (fully local generation) | Grounded answer, citations from the corpus, no refusal; generation ran on local Ollama with no hosted key |

Also confirmed as a by-product: pointing `DESKBELL_EMBEDDING_MODEL` at `ollama/nomic-embed-text`
(768-dim) makes the reindex dimension probe refuse before any write — the D13 model interface
proven with a second real embedding provider, not only a synthetic mismatch.

**`/api/v1/ask` security re-run — verified live 2026-08-25** against a production build
(`NODE_ENV=production`, standalone server), covering the `apps/docs/content/docs/security.mdx` matrix on the
guarded path this spec touches: bot UA → 403; POST without `Origin` → 403; `Origin: null` →
403 `not_allowed`; third-party origin with an empty allowlist in production → 403
`unconfigured` (fail-closed); allowlisted origin → 200 streaming a real grounded answer
(the guard→engine handoff intact); unlisted origin → 403 `not_allowed`; same-origin GET
`/config` → 200; rate limit → 429 carrying `retry-after`, `access-control-allow-origin`
and `access-control-expose-headers: retry-after`. The guard runs to completion before the
engine is constructed, so this confirms the grounded-generation change did not regress it;
the guard matrix is also pinned by the web unit suite (57 tests).

Still outstanding, for the sections not yet built:

1. The follow-up and citation flows in a browser rather than over HTTP — in particular that
   pills arriving after the tokens still render, which is the one visible change here.
2. With the floor off, a weak-match question gets an answer or an honest `NO_GROUNDING`
   refusal from the model — not a pre-model refusal. (Note the cold-question row above is
   currently a *pre-model* refusal, which §5 is what changes.)
3. The same follow-up flow in a browser rather than over HTTP.

Then `pnpm lint`, `pnpm typecheck`, `pnpm build`.
