# Activity disclosure in the widget

**Status:** done · **Date:** 2026-10-22 · **Builds on:** `2026-09-22-action-presentation`

## Problem

An answer that called eight tools shows eight step lines above one paragraph.
Each line is right on its own — the label, the check mark, the quiet status
word — and together they push the answer below the fold and say nothing the
visitor can read: the same label repeated, with no account of why the model
chose those calls or how long they took. The model's reasoning, which would
answer *why*, is dropped on the floor in the model layer: the stream handler
has a case for every part type except the reasoning ones.

## Design

### One fold per answer

The step lines move under a native `<details>` with one summary line, the
**activity** group:

- **While the model works** the group is open, its summary reads
  *Thinking…* with a spinner, and the lines inside fill in live as they did
  before. The typing dots stay away while a step runs or reasoning streams,
  as the spinner already says the widget is busy.
- **Once the answer starts** the group folds. Its summary becomes *Worked for
  3s · 8 steps*: the seconds from the question to the first thing the
  visitor was told (a token, a refusal, a clarification, a card), rounded
  and never zero, then the step count. A replayed message has no timing, so
  it reads *8 steps*; a group with reasoning but no calls reads *Worked for
  3s*.
- **The visitor's toggle wins.** Opening a folded group, or closing a live
  one, is remembered on that message for the session. A toggle that lands
  on what the automatic rule would have chosen anyway clears the
  remembered choice, so the rule takes over again.

Inside the fold, consecutive step lines form one `actions` list exactly as
before — same classes, parts and status words — and reasoning renders as a
quiet block with a left rule between them, in the order things happened.
Confirmation cards stay outside the fold: a card is a question for the
visitor, not an account of what already happened. A message with no steps
and no reasoning renders no group; a plain answer looks exactly as it did.

### Reasoning on the wire, off by default

`GenerationPart` and `AnswerEvent` gain `{ type: "reasoning"; value }`,
a delta at a time. The model layer maps the SDK's `reasoning-delta` part to
it; the engine yields it straight through, outside the refusal and
clarification holds (it is not an answer) and outside the verification (it
was never said). The widget keeps a **trail** per message — reasoning
segments and step ids in arrival order — so the fold can interleave them;
`actions` remains the record a card or a step line is drawn from, and a
replayed message, which has no trail, falls back to its stored calls.

The ask route drops `reasoning` events unless `DESKBELL_SHOW_REASONING` is
true. The flag is a deployment decision and never the request's: the
endpoint is public, and reasoning quotes the retrieved context, names the
tools and the refusal sentinel, and talks about the visitor in the third
person. On `openai/*` the same flag adds `reasoningSummary: "auto"` to the
chat model's provider options, because those models emit no reasoning text
unless a summary is requested; the planner and the reranker are not asked,
as nothing they think reaches the visitor. Reasoning is not stored and not
replayed.

Copy keys added: `activityDone` (*Worked for {s}s*), `activitySteps`
(*{n} steps*), `reasoning` (*Reasoning*, the block's accessible label).
Copy strings now take `{name}` placeholders, filled by the widget. Parts
added: `activity`, `activity-summary`, `reasoning`. The `actions` part now
sits inside `activity` rather than directly under `message`.

## Non-goals

- Persisting reasoning, or showing it in the dashboard's conversation view.
- A per-project switch in the dashboard: one environment flag is enough
  until a deployment asks for both behaviours at once.
- Requesting reasoning from providers that do not emit it by default
  (Anthropic extended thinking, Google thoughts): that changes cost and
  latency for a display feature, and is a model-configuration decision.
- Rendering reasoning as Markdown. It is plain text with the whitespace kept.

## Verify

- `@deskbell/core`: `reasoningVisible` reads the flag; `reasoningProviderOptions`
  adds the summary request for openai only when visible; the engine passes
  reasoning parts through in order, ahead of the holds.
- `packages/widget-core`: DOM tests for the open-while-running group, the
  folded summary with seconds and count, reasoning blocks in order between
  step lines, the replayed message's count-only summary, no group on a plain
  answer. Existing step-line and card tests pass under the new structure.
- `apps/web`: `e2e/widget/actions.spec.ts` sees the summary line and the
  reasoning block from a stubbed stream.
- Gates: typecheck, lint, tests, build (widget under 40 KB gzip),
  `docs:widget --check`.
