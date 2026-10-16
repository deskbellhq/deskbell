# Spec: license-file-layout

**Status:** done (2026-08-21)
**Amends:** D3/D11 licence mechanics — see `.ai/decisions/D03-license-split.md`

## Problem

Two defects in the licence layout, both found by inspection:

1. **GitHub detected the repository licence as "Other."** Verified via
   `gh repo view deskbellhq/deskbell --json licenseInfo` → `{"key":"other"}`.
   The cause was the ~25-line carve-out preamble prepended to the AGPL text in
   `LICENSE`, which defeats GitHub's fuzzy licence matcher. On a public repo the
   sidebar would have read "Other" — the same signal that non-OSI and
   source-available projects give off, and the opposite of what this project
   claims about itself.

2. **The MIT grant was unresolvable.** The root `LICENSE` stated that six
   packages are "licensed under the MIT License as defined in each package's own
   LICENSE file," but no such files existed. Only `LICENSE` and
   `packages/ee/LICENSE` were present.

D11 had chosen the cal.com pattern (carve-out paragraph inside the root
LICENSE) over documenso's, on the grounds that dropping the root pointer is
"legally murkier." That reasoning stands, but it assumed the preamble was free.
It isn't.

## Change

- `LICENSE` — replaced with the verbatim FSF AGPL-3.0 text, byte-identical to
  <https://www.gnu.org/licenses/agpl-3.0.txt> (661 lines, verified by diff).
  Nothing added.
- `LICENSING.md` — new. The authoritative map of the three licences, plus what
  each means for someone embedding the widget versus self-hosting the server,
  and the statement that the answering core is never EE.
- `packages/{widget-core,widget-snippet,widget-react,sdk,ui,shared}/LICENSE` —
  six new MIT files. These are the operative grant for those directories, which
  is stronger than a sentence in the root file pointing elsewhere.
- Root `package.json` — `license` now `SEE LICENSE IN LICENSING.md`.
- `README.md` — links LICENSING.md.

Per-package `package.json` `license` fields were already correct
(`AGPL-3.0-only` on apps/core/connectors/db/evals, `MIT` on the six
embeddables) and are unchanged.

## Why the pointer moving is not a regression

The root pointer is not dropped — it moves to `LICENSING.md`, is linked from
the README, and is now backed by real per-package LICENSE files that did not
exist before. Net result is more explicit than the previous layout, plus
correct licence detection.

## Verify

- `diff <(curl -s https://www.gnu.org/licenses/agpl-3.0.txt) LICENSE` → empty
- `find . -name LICENSE -not -path "./node_modules/*"` → 8 files
- After the repo goes public: `gh repo view deskbellhq/deskbell --json licenseInfo`
  should report `agpl-3.0`. **Not yet confirmable — the matcher runs on the
  pushed tree, and this needs re-checking after the next push.**

## Open

`LICENSING.md` wording should be reviewed by the attorney alongside the
pre-launch opinion already on the checklist. The structure is standard; the
phrasing around the embedding case is the part worth a lawyer's eye.
