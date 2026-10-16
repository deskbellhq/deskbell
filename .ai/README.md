# `.ai/` — the builder's record

Everything here is written for whoever is building Deskbell next: a contributor, a
maintainer, or a coding agent. It is fully public and version-controlled — there is no
private tier and no separate machine-readable copy to drift out of sync.

## What lives where

| Directory | Holds | Audience |
|---|---|---|
| [`decisions/`](decisions/) | Architectural decisions that constrain the codebase, one file per decision | Anyone asking "why is it built this way, and may I change it?" |
| [`specs/`](specs/) | The design record for a unit of work, written before the work | Anyone implementing or reviewing that work |
| [`../docs/`](../docs/) | How to **run and use** Deskbell — security posture, widget customization | Self-hosters and people embedding the widget |

The line between `.ai/` and `docs/`: **`docs/` is for users of Deskbell, `.ai/` is for
builders of Deskbell.** If a self-hoster needs it to operate their instance, it belongs
in `docs/`.

## `decisions/`

Files are named `D{NN}-{kebab-slug}.md`. The numbering is stable and referenced directly
from code — when you see `(D12)` in a comment, `.ai/decisions/D12-*.md` is what it means.

The numbering is **not contiguous**. Decisions that carry no consequence for the codebase
have no file here. A gap is not a missing document.

Each file states the decision, why it was made, what it rules out, and where in the
codebase it bites. They are constraints, not history — if a decision changes, the file
changes and says so, in public. That is especially true of the licence boundary (see
[D3](decisions/D03-license-split.md) and `LICENSING.md`).

## `specs/`

Non-trivial work starts as a spec: `specs/{YYYY-MM-DD}-{kebab-title}.md`. `TODO(spec: name)`
comments in the code mark where a spec is expected to land.

Use this header for new specs:

```markdown
# {Title}

> Status: {planned | in progress | done} · {YYYY-MM-DD}

**Goal.** One paragraph: what changes and why it is worth doing.

## Design
## Non-goals
## Open questions
## Verify
```

Specs written before this convention use two earlier header formats. They have not been
retrofitted — the content is what matters, and churning thirteen files to normalise
headings buys nothing. New specs use the shape above.

## What does not belong in this repository

This is a public repository. Keep out of it:

- Business strategy — targets, gates, go/no-go criteria, pricing or revenue plans.
- Competitive positioning, comparisons, or teardowns of other products. Naming a product
  we **integrate with** is fine and useful; ranking ourselves against one is not.
- Narration of the authoring process — which tool, session, or assistant produced a
  change. Write what the code does and why, not how the writing happened.

If a rationale cannot be stated without one of the above, state the part that stands on
its own engineering merits and leave the rest out.
