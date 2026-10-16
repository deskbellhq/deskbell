# D8 — The eval harness ships with v1

**Decision.** `packages/evals` is part of the v1 release, not a follow-up. It replays a
golden question set against the engine, judges the answers, and reports. It runs in CI.

**Why.** The failure mode of a retrieval-augmented answer engine is not the obvious
wrong answer — it is the confident, fluent, *almost* right one, which is exactly the
kind a human spot-check waves through. The only way to know whether a chunking change,
a prompt edit, or a model swap made answers better or worse is to measure it against a
fixed set. Without that, every change is a guess, and quality drifts silently in
whichever direction the last edit pushed it.

Grounding and refusal (D-adjacent, see `packages/core`) are only credible if they are
measured. "It refuses when it should" is a claim; the harness is the evidence.

**What this rules out.** Deferring evals to "once the product settles". Merging retrieval
or prompt changes on vibes. Treating the golden set as optional CI.

**Where it bites in code.** `packages/evals/` · CI runs it (`.github/workflows/ci.yml`) ·
the golden set is seeded from real questions, not invented ones. `TODO(spec: eval-harness)`
marks where the full harness lands.
