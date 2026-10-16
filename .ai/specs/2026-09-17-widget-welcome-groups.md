# Welcome cards

> Status: done · 2026-09-17

**Goal.** The empty state offers up to four flat suggested questions. Products
with several areas want the first screen to say what the assistant can help
with, area by area, each with a couple of prompts. This spec adds grouped
prompts as an option; the flat list stays for everyone who has it.

## Design

**`promptGroups`.** A JSON array of `{ title, description?, icon?, prompts[] }`,
at most 8 groups of 6 prompts, with the same length caps as the rest of the
descriptor. When set it replaces the suggested questions in the empty state.
Clicking a prompt asks it, exactly as a suggested question does.

**Icons are URLs.** A named icon set would put a font or a sprite in every
bundle; an SVG string would need sanitising. A URL costs nothing and a
`data:image/` URL costs no request. Only `http(s)` and `data:image/` pass; the
coercer drops anything else rather than failing the option.

**Surface.** Parts `welcome`, `welcome-card`, `welcome-card-icon`,
`welcome-card-title`, `welcome-card-description`, `welcome-prompt`, and
`welcome-title` for the new heading. One column in the popover, two inline.

**Dashboard.** Hidden from the generated Appearance form for now, like `theme`
and `copy`: it is a JSON value and the form has no JSON control. Stored
appearance validates it through the same schema as attributes.

## Non-goals

- Per-group source filtering. A prompt is a question, nothing more.
- Reordering by usage.

## Verify

- Coercion from attribute JSON and from a server object; malformed groups and
  unsafe icons dropped; caps applied.
- Appearance schema accepts a valid group and rejects an unsafe icon.
- Cards render in the empty state and a prompt click asks the question.
