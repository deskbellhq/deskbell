# Answer style: a per-project paragraph on how the assistant sounds

> Status: done · 2026-10-23

**Goal.** The instruction the model reads is the same for every deployment and
every project: it decides what an answer may say and leaves how it sounds to
the model's defaults. Operators want a say in that: shorter answers, a
particular form of address, a language, a house rule about formatting. Today
the only way is `EngineOptions.systemPrompt`, which replaces the whole
grounding contract and is not reachable from the dashboard. This adds one
text field per project, edited in the dashboard, appended to the contract on
every answer. Empty, the prompt is byte-identical to today's.

## Design

**One column, per project.** `projects.answer_style`, text, not null,
default empty. Per project rather than per deployment because the rest of a
project's behaviour (origins, budget, appearance, identity, gaps) is already
a row, and a second project on the same instance will want a second voice.
Validated with `AnswerStyleSchema` on write: trimmed, so a blank textarea
stores nothing, and capped at 2,000 characters, so it stays a paragraph and
cannot become a second prompt. Read by the ask endpoint only. The public
config endpoint spreads `appearance` and nothing else, so the field is never
served to the widget; a visitor has no use for the operator's instructions.

**Appended last.** `buildSystemPrompt` composes base, clarification,
verification, then the style; `TOOLS_PROMPT` follows as before. Last so the
grounding paragraphs are unchanged and keep their position in every
fingerprint; the style can shade them, not move them. The builder trims
again, so a host that passes whitespace sends the same prompt as one that
passes nothing.

**Per call, not per engine.** The style rides on `AskInput`, beside
`ignoredTerms`, not on `EngineOptions`: one engine serves every project, and
the style is a row on the project. The engine never reads the environment or
the database for it (D10); the ask route passes the row's field, the eval
target passes what it read from the project.

**Measured, not trusted.** The eval project target replays the project's
style and folds it into the prompt fingerprint, so two runs that differ only
in style are told apart in the report. A style is a prompt change, and prompt
changes move every quality number; the docs page says so.

**The dashboard page.** `Settings → Answer style`, admin-gated like the
origin allowlist and retention. One textarea, a character counter, a save
that says whether a style was set or cleared. Listed in the settings sidebar
and the command palette.

## Non-goals

- Replacing the grounding contract from the dashboard. `EngineOptions.systemPrompt`
  stays a host-level override for people running their own transport; the
  dashboard never exposes it.
- Guarding against a style that argues with the contract. The field is the
  operator's own instruction on their own instance; the refusal sentinel, the
  sources line and verification still run, and the docs say that a style
  which fights them makes answers worse.
- Per-conversation or per-visitor style. Nothing in the widget request names
  one, by design: the request is public and must not carry instructions.

## Open questions

- Whether a style should be able to turn verification's bold-the-names
  request off for a project, since bold is visible in the answer and some
  voices will not want it. Today the style can ask for no bold, and
  verification then checks fewer names. Measure before deciding.

## Verify

- `buildSystemPrompt` tests: undefined, empty and whitespace styles are
  byte-identical to the bare prompt; a set style lands after verification.
- `AnswerStyleSchema` tests: trim, inner line breaks kept, cap after trim.
- Playwright `settings-answer-style.spec.ts`: a style survives save and
  reload; clearing stores nothing; the sidebar lists the page.
- Manual: set a style, ask the widget, read the answer; clear it, ask again.
