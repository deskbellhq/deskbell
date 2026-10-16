# Local cross-encoder reranker: real ranking without a service

> Status: built 2026-08-26, opt-in (`DESKBELL_RERANK=local`). Extends
> `2026-08-24-hybrid-retrieval.md` §4, which designed the seam this driver plugs into.
> Whether it becomes the default is a harness sweep (D8), not a claim here.

**Goal.** The rerank seam shipped with an LLM driver — zero dependencies, but a chat
model asked to order passages is an improvisation: seconds of latency, tokens on every
answer, and ranking quality that is an open question. A cross-encoder is the
purpose-built instrument — it reads (question, passage) pairs and emits one relevance
logit each — and the Postgres-only bar (D11) rules it out only as a *service*. This
driver runs one **in-process**, on CPU, through ONNX: real reranking, no sidecar,
`docker-compose.yml` untouched.

## The decision this records

**An opt-in driver may carry an optional native dependency and download model weights at
runtime; the default install may not.** The concrete costs, stated so nobody discovers
them later:

- `@huggingface/transformers` pulls native onnxruntime binaries — tens of megabytes of
  install weight per platform. That is acceptable for an operator who chose the feature
  and unacceptable as a tax on every `docker compose up`, so it is a **peer dependency
  marked optional**, installed deliberately next to the app that runs the engine. The
  dynamic import uses a variable specifier on purpose: the package's absence is a
  *supported state* with a defined per-request error (naming the install command), never
  a build failure — bundlers and the type checker must not try to resolve it.
- Model weights (~25 MB quantized for the default) download from the Hugging Face hub on
  first use and cache locally. First-ever use therefore needs hub access; air-gapped
  deployments pre-seed the cache. Documented in `configuration.mdx`.
- What this rules out: the dependency ever moving into `packages/core`'s hard
  dependencies, the driver ever becoming a compose service (`packages/core/AGENTS.md`
  rule; D11), and weights ever being committed to the repository.

## Design

- **Default model `Xenova/ms-marco-MiniLM-L-6-v2`** — the standard MiniLM-class
  reranking cross-encoder, Apache-2.0, ONNX weights on the hub. `DESKBELL_RERANK_MODEL`
  names any other sequence-classification cross-encoder. Quantized (`dtype: "q8"`):
  a fraction of the download and RAM for an output that is an *ordering*, not a
  generation.
- **Process-wide encoder cache, keyed by model id.** The web app constructs engine deps
  per request; re-loading tokenizer + weights each time would cost seconds per answer.
  One process loads a model once. Injected test loaders bypass the cache so tests cannot
  bleed into each other.
- **Background warm-up, lazy contract intact.** Loading starts at construction so the
  first visitor usually finds the model warm — but construction never throws and never
  blocks (the availability contract every model-backed dep in this module follows). A
  missing package or failed download surfaces on the request path, where the engine
  keeps fusion order; a failed load is retried on the next request, so an operator who
  installs the package or regains network does not need a restart.
- **No timeout.** A native forward pass cannot be aborted, so a timeout would abandon a
  computation that keeps burning CPU. The batch is bounded by the shared candidate cap
  (`MAX_RERANK_CANDIDATES`) instead; the engine's try/catch still owns every failure.
- **Scores are returned.** Unlike the LLM driver, a cross-encoder's logits are real
  relevance measurements, so `RerankResult.scores` carries them — on the driver's own
  scale, which per hybrid-retrieval §5 nothing thresholds by default. Observed shape on
  the dev corpus: relevant passages score positive, correct-but-partial ones sit
  moderately negative, junk sits deeply negative — which is exactly why any future
  rerank-stage floor needs calibration against real traffic, not a guess at zero.

## Measured (dev hardware, dev corpus — the harness produces the numbers that count)

- Cold first call including download + load: ~17 s (one-time; hidden by warm-up in
  practice). Warm: **~93 ms per candidate** on CPU — a pool of 24 costs ~2 s of
  parallelism-free CPU, roughly 3–10× faster than the LLM driver and at zero token
  cost.
- Ordering sanity: on a data-flow question the two data-flow pages ranked first at
  positive logits; an unrelated rate-limiting page ranked last at −11.

## Open questions (sweeps, not opinions)

- Does `local` beat fusion-only and `llm` on the golden set? (`pnpm sweep` carries a
  `hybrid-multi-rerank-local` configuration.)
- Whether `local` can become the shipped default: quality aside, that decision has to
  price the optional-dependency friction — a default that needs a manual install is not
  a default. If the sweep says the quality is decisive, the install story (bundling the
  dependency in the Docker image while keeping the bare install light) becomes its own
  change.
- `dtype` (q8 vs fp32) as a quality/latency trade; batch-size behaviour at larger pools;
  a configurable cache directory for operators who mount volumes.

## Verify

Unit: driver policy pinned with an injected encoder (ordering by descending logit with
stable ties, single-candidate identity without waiting on the loader, construction never
throwing, retry after a failed load, the candidate cap). Live (manual pass, done
2026-08-26): real weights on real corpus rows — valid total order, descending scores,
the latency numbers above; full monorepo build green with the package absent from the
build graph.
