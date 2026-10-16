# Gap clusters: compare to every phrasing, embed without the product's name

> Status: done · 2026-09-22
> Amends: 2026-09-10-gap-clusters — assignment steps 3–4, "Leaders are compared
> exactly", the per-message-embedding non-goal, and Measurements. The rest of that
> spec stands: clusters persist, resolve and reopen by themselves, and degrade to
> text grouping when embeddings are unavailable.

**Goal.** Two questions land in one cluster when they are one need, and in two when
they are not. Today the assignment compares a new phrasing with each cluster's
*leader* — the first phrasing ever seen — and embeds the question exactly as it was
typed. Both cost accuracy in ways that were measured, not guessed: a cluster stops
absorbing paraphrases as soon as its leader is the odd one out, and the product's own
name, repeated in every question, pulls unrelated questions together. This keeps every
phrasing's vector so the comparison runs against all of them, and lets a project name
the words that carry no meaning in its own gap questions.

## Why

Measured on 2026-09-22 with `scripts/measure-gap-clusters.ts` over the development
project's 42 gap questions plus 24 asked through a fresh instance the night before
(`openai/text-embedding-3-small`, every pair at or above 0.55 labelled by hand):

- **The bands overlap.** Same-need pairs run from 0.929 down to 0.572; different-need
  pairs from 0.826 down to 0.553. No single threshold separates them, so the
  2026-09-10 default of 0.80 is not a knob that was set wrong — it is a knob that
  cannot be set right on this input.
- **The name is what overlaps them.** Every different-need pair above 0.70 contains
  the product's name in both questions. Re-embedding the same questions with that one
  word removed drops them to 0.29–0.49 — "What is Deskbell?" against "How much does
  Deskbell cost?" falls from 0.826 to 0.315 — while same-need pairs stay or rise: the
  two phrasings of the infrastructure-dependency question go from 0.728 to 0.965.
  After stripping, the highest different-need pair in the set is 0.556.
- **Leader-only comparison under-merges.** "How do I put the widget on my site?"
  scores 0.896 against a phrasing inside the embed cluster and 0.774 against that
  cluster's leader, so at 0.80 it starts a second cluster for a need that already has
  one.

The first two are one bug with one visible symptom: at 0.80 the pricing question is
merged into "What is Deskbell?" and disappears from the page. Over-merging hides a
question, which is the failure the threshold was chosen to avoid.

## Design

### Every phrasing keeps its vector

`gap_phrasings` — one row per distinct normalised question in a project:

| column | |
|---|---|
| `id`, `org_id`, `project_id` | tenancy as everywhere (D12) |
| `cluster_id` | the cluster this phrasing belongs to; cascade-deleted with it |
| `text` | the question as first typed, for reading and for re-embedding |
| `normalized_key` | `normalizeQuestion(text)`; unique per project |
| `embedding`, `embedding_model` | null when the embedder was unavailable; healed later |
| `first_seen`, `last_seen` | when this wording was first and last asked |

Unique `(project_id, normalized_key)`: one row per wording, and the conflict is what
makes two workers racing on the same wording a no-op. No approximate index — the
reasoning from the original spec holds and applies to more rows: a project's distinct
gap wordings number in the low thousands, and an exact scan under the tenant filter
avoids the approximate-scan problem the retrieval-defaults spec measured. An index
comes when a measurement says the query is slow.

`gap_clusters.leader_embedding` **goes away.** The leader's vector is its phrasing's
vector; keeping a second copy is state that drifts. `gap_clusters.embedding_model`
stays as the model the cluster was built with — the dashboard's stale-model notice
reads it, and it is written whenever the leader phrasing is embedded.

### Assignment compares to phrasings, not leaders

Steps 1 and 2 are unchanged (a message that has a cluster stops; an exact normalised
match joins without an embedding call — now by looking the wording up in
`gap_phrasings`). Steps 3 and 4 become:

3. Embed the question — with the project's ignored names removed (below) — and find
   the nearest *phrasing* in the same project and embedding model. Join its cluster if
   the similarity clears `DESKBELL_GAPS_CLUSTER_SIMILARITY`.
4. Otherwise create a cluster with this question as label and leader.

Either way the new wording is written to `gap_phrasings` with its vector, so the next
paraphrase is compared against it too. A cluster therefore keeps absorbing wordings
that are close to anything it already holds, which is what "clustered by meaning"
promises and what the leader-only comparison could not deliver.

An embedding failure is still not an assignment failure: the phrasing row is written
without a vector, and the catch-up pass fills it in.

### Names a project's questions carry no meaning in

`projects.gaps` (jsonb, validated by `ProjectGapsSchema`) holds `ignoredTerms`: words
removed from a question **before it is embedded** and nowhere else. The label on the
page, the normalised key, the export and the analysis all keep the question as it was
typed.

- Unset (the default) means one term: the organisation's name. A project that has
  never been configured behaves as most projects want without anyone visiting a
  settings page.
- An empty list means exactly that — nothing is stripped. Unset and empty are
  different on purpose, so choosing "strip nothing" survives an org rename.
- Matching is case-insensitive and whole-word, so "Deskbell" and "deskbell" go and
  "Deskbells" stays. A term may be several words. If stripping would leave nothing,
  the original question is embedded instead: "Deskbell?" is a question about the
  product, not an empty string.

The setting lives at **Settings → Gaps**, admin-gated like the origin allowlist: it
changes how questions are grouped for everyone reading the page.

### Changing any of this needs a re-cluster

Stripping moves questions in the embedding space, so vectors written before a change
are not comparable with ones written after. The existing re-cluster action is the tool
— it already exists for a threshold or embedding-model change — and the settings page
carries it, under the form that makes it necessary. It had no permanent home before:
the only way to reach it was the stale-embedding-model warning on the Gaps page, which
appears when a model changes and never when a setting does. Nothing re-clusters
automatically: it loses resolved state, which is the operator's decision, never a side
effect of saving a form.

### Migration

`gap_phrasings` is created and backfilled from the clusters that exist: one phrasing
per cluster carrying its label, key, leader vector and model. `leader_embedding` is
dropped afterwards, in the same migration.

Wordings other than the leaders are not reconstructed. They could be — the text is in
the messages table, behind the correlated subquery that defines "the question a gap
row answered" — but rebuilding them means re-embedding history under a normalisation
the database cannot group by, which is exactly what a re-cluster does, on demand and
with the operator's knowledge that it drops resolved state. So: the upgrade keeps
every cluster and starts remembering wordings from the next question on, and an
operator who wants the new comparison applied to history re-clusters, from the
settings page.

A re-cluster needs no new code: deleting a cluster cascades to its wordings, and the
catch-up that follows writes one per distinct wording as it assigns.

## Non-goals

- Anything on the ambiguous band itself. A model check ("would one written answer
  satisfy both?") is the only thing measured to reach the pairs at 0.57–0.72 without
  merging different needs, and it spends tokens per question; it is not built here.
  Nothing in this spec forecloses it: it would sit between "nearest phrasing" and the
  threshold test.
- Moving `DESKBELL_GAPS_CLUSTER_SIMILARITY`. The re-run below is the evidence that
  decides it, and on this evidence it does not move.
- Splitting, merging or renaming clusters by hand. Re-cluster is still the blunt tool.
- A vector per *message*. A vector per distinct wording is what the comparison needs;
  a hundred repeats of one wording still embed once.

## Verify

- A paraphrase that is close to a non-leader wording of a cluster joins that cluster,
  and the worker log says `via=embedding`.
- Two questions that differ only by the product's name no longer merge on a project
  whose ignored terms include it; the page still shows both labels with the name in
  them.
- Saving an empty ignored-terms list on a project whose organisation is renamed
  afterwards strips nothing.
- Stopping the embedding provider still assigns by wording and writes vectorless
  phrasings; restoring it lets the catch-up heal them, and a paraphrase then joins.
- After a re-cluster every gap row has a cluster and every distinct wording has a
  phrasing row with a vector.
- An install that upgrades without re-clustering keeps its clusters, and a repeat of
  an older wording joins the cluster it already belonged to (by wording, as before).
- Tests: the assignment paths with fake dependencies (join by wording, join by a
  non-leader phrasing, create, reopen); stripping (case, word boundary, multi-word
  terms, empty result, unset versus empty); the catch-up's healing order and slicing;
  the settings action's validation and role gate.

## Measurements

**Re-run of `scripts/measure-gap-clusters.ts`, 2026-09-22**, over the same input as
the measurement in Why — the development project's 42 gap questions plus the 24 from
a fresh instance — with `--terms Deskbell` and the wording comparison, on
`openai/text-embedding-3-small`.

**Stripping removes the wrong pairs and nothing else.** Pairs at or above 0.55 fall
from 42 to 25, and every pair that disappears is one whose similarity came from the
name: "What is Deskbell?" against "How much does Deskbell cost?" is no longer in the
list at all, while the two wordings of the infrastructure-dependency question rise
from 0.728 to 0.965. In this input the highest different-need pair is now 0.556
("How do I install the widget?" against "How do I change the widget's colours?") and
the lowest same-need pair is 0.575 (two ways of asking for a Slack app).

**Comparing with every wording does what the leader could not.** At the unchanged
0.80, "How do I put the widget on my site?" joins the embed cluster — 0.774 against
its leader, 0.896 against a member — and the cluster holds four wordings instead of
three. No other cluster changes at that threshold.

**The default stays at 0.80.** The condition for moving it was that the bands
separate; over the dev project, the traffic questions *and* the private tuning set
together, they still overlap. The highest different-need pair across all three is
0.693 — two questions about one set of environmental-claims rules, neither carrying
a product name, so stripping does not touch them — while the same-need pairs this
change was meant to reach (Notion, Slack, Zendesk, CSV export) sit at 0.575–0.723.
Any threshold low enough to merge those merges the 0.693 pair too.

| threshold | what it would add | what it would cost |
|---|---|---|
| 0.80 (current) | — | — |
| 0.75 | "How do I install the widget?" joins the embed cluster | nothing measured; the margin over the worst different-need pair halves to 0.057 |
| 0.70 | nothing further | a margin of 0.007 — inside the noise |
| 0.65 | Notion ×3, Slack, Zendesk | the environmental-claims pairs at 0.663 and 0.693 |

0.75 is the only defensible move and it buys one merge, so the knob is left alone and
the band between 0.57 and 0.72 stays where a model check would have to reach it.

*Reproduce:* `pnpm exec tsx --env-file-if-exists=.env scripts/measure-gap-clusters.ts
--project <id> --dataset <questions.json> --floor 0.55 --terms "<name>"`, and again
with `--no-strip --leader-only` for the behaviour before this spec.
