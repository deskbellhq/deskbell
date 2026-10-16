# Reasoning effort on the answer path

> Status: done · 2026-09-14

**Goal.** A question in the widget waited ten to forty-five seconds for its
first token. Nothing in the pipeline was slow: embedding takes under 300 ms,
the vector search milliseconds, the guard tens of milliseconds. The default
chat model is a reasoning model, and left at the provider's default effort it
deliberates for five to six hundred hidden tokens before the first visible
one — on a grounded question whose answer is one short paragraph, and on a
refusal that emits nothing at all. Those tokens are billed as output: one
day's usage showed ~25,700 output tokens for a handful of ~100-token answers.

## Design

**One setting, on the model, for the visitor path.** `DESKBELL_REASONING_EFFORT`
takes `low` (default) | `minimal` | `medium` | `high` | `provider`. It is
applied in the model-config module (`packages/core/src/models/index.ts`) by
wrapping the language model with default provider options, so the answer, the
query planner and the LLM reranker all inherit it from one factory and none
of them can forget. The judge and the gap analyst construct their models
without it and stay at the provider default: nobody waits on them, their job
is judgement, and the eval baselines were recorded without the setting.

**Grounded QA is not a deliberation task — but the refusal contract needs
some.** The context is in the prompt; the model's work is to write from it or
refuse. The first draft of this spec defaulted to `minimal` on the strength of
two refusal cases where the answer text was identical at every level. Probing
three *answerable* questions overturned it: at `minimal` the default model
refused two of the three (twice each), at `low` it answered all three. A false
refusal is the failure this product exists to avoid, so `low` is the default
and `minimal` stays available for operators whose corpus tolerates it. The
rest of the latency is a model choice, not an effort setting: in the same
probe a non-reasoning model answered all three with a first token in 0.8 to
1.7 s. Flipping the default chat model is a separate decision against the
harness (D8).

**`provider` means send nothing.** It exists so an operator can take whatever
the provider decides, and so the code paths that deliberately do so read as a
choice rather than an omission. Only `openai/*` has the concept today; on
other providers every value is a no-op. The OpenAI provider ignores the
setting with a warning on non-reasoning models, so a `gpt-4.1-mini`
deployment needs no change.

## Non-goals

- Mapping the levels onto Anthropic's or Ollama's thinking controls. Neither
  reasons by default under the wired providers, so there is nothing to turn
  down; a mapping lands when a default there starts costing seconds.
- Flushing SSE headers before the first event. The widget sees nothing until
  the first token because the response is not flushed until then; that is a
  separate, transport-level change in `apps/web`.
- Per-role effort settings. One knob covers the path the visitor waits on;
  the roles that are not on it are exempt by construction.

## Verify

- `reasoningEffort` parses every level case-insensitively, defaults to
  `minimal`, and falls back to `minimal` on nonsense.
- `reasoningProviderOptions` yields options for `openai` only and nothing for
  `provider`.
- `createEngineModelDeps` builds at every level for every wired provider
  without touching the network.
- Live: a question through `/api/v1/ask` against the dev corpus reaches its
  first token in two to four seconds where it took ten or more.
- The private set (`--judge llm`) at the new default against the recorded
  baseline: Factuality and false-refusal rate must not fall (numbers below).

## Measurements

Default chat model, dev corpus (50 documents, 97 chunks), eight retrieved
chunks (~14–16k characters of context), streamed through the AI SDK directly.

Two unanswerable questions (both correctly refused at every level):

| Effort | Time to first token | Reasoning tokens | Output tokens |
|---|---|---|---|
| provider default | 8.7–10.6 s | 512–576 | 602–644 |
| low | 3.7–4.6 s | 192 | 227–260 |
| minimal | 1.1–1.4 s | 0 | 26 |

Three answerable questions (ETM, rule box, Stream API), one run each plus
two extra runs of the first:

| Setting | Time to first token | Answered |
|---|---|---|
| gpt-5-mini, provider default | 6.5–9.9 s | 3 of 3 |
| gpt-5-mini, low | 2.7–4.9 s | 3 of 3 |
| gpt-5-mini, minimal | 0.9–2.3 s | 1 of 3 (ETM refused 3 of 3 runs) |
| gpt-4.1-mini (no reasoning) | 0.8–1.7 s | 3 of 3 |

`none` is rejected by gpt-5-mini with a 400, so it is not an accepted level.

Live through `/api/v1/ask` after the change (engine latency as persisted):
1.9 s and 4.1 s where the same questions took 11.8 s before.

Private set (99 cases, `--judge llm`, judge `anthropic/claude-haiku-4-5`) at
the new default, against the recorded baseline. The system prompt changed the
same day (spec sources-line-and-thread-status), so the prompt hash differs
and the citation numbers are not attributable to effort alone; the refusal
and factuality numbers are the ones this change could have moved.

| Metric | Baseline (provider default) | `low` |
|---|---:|---:|
| Factuality | 79.1% | 81.9% |
| Uncertainty | 85.0% | 90.0% |
| False-refusal rate | 7.6% | 7.6% |
| Groundedness | 94.5% | 97.3% |
| recall@8 / nDCG@8 | 0.882 / 0.720 | 0.882 / 0.720 |
| Answer latency, median / p95 | — | 5.0 s / 9.8 s |

Nothing fell. The baseline is not updated here: a baseline change is a
reviewed act, and this run should be re-checked once the prompt-hash change
has its own baseline.
