# D3 — AGPL core, commercial EE, and where the fence sits

**Decision.** Deskbell is AGPL-3.0 at the core with a commercial Enterprise Edition in
`packages/ee`. The fence runs along the **operations and compliance plane** — SSO/SAML,
SCIM, multi-org management, custom roles, audit logging, advanced retention. The
**answering core is never Enterprise Edition**: retrieval, grounding, citation, refusal,
and evaluation are AGPL and stay AGPL.

**Why.** An open-source support agent whose actual intelligence is paywalled is not an
open-source support agent — self-hosters would get a demo, not a product. Fencing the
answering core would make the free tier useless for the people the project exists for.
Putting the fence on the ops/compliance plane instead means the free tier is complete
for a team running one organisation, and the paid tier sells to the buyers who need
identity and audit infrastructure.

**What this rules out.**
- Moving any part of the answer path behind the EE gate.
- Silent boundary changes. If the fence ever moves, it moves as a commit in
  `LICENSING.md` and `packages/ee/FEATURES`, in public.
- MIT packages (`widget-*`, `sdk`, `ui`, `shared`) importing AGPL packages, or anything
  outside `packages/ee` importing from it except behind a documented feature gate.

**Where it bites in code.** `LICENSING.md` (authoritative map) · `packages/ee/FEATURES`
(explicit manifest) · `packages/ee/LICENSE` · the six MIT `packages/*/LICENSE` files ·
root `LICENSE` is verbatim AGPL-3.0 with nothing added, so GitHub's licence matcher
resolves it (see `.ai/specs/2026-08-21-license-file-layout.md`).
