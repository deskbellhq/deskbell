# Overview: a getting-started page until the widget is live

> Status: in progress · 2026-09-14

**Goal.** A fresh dashboard opens on an Overview built for a project with
history: four stat cards showing zeros, a ninety-day chart with nothing in
it, an empty conversations table, and above them a small three-step
checklist whose every step links somewhere else. The one thing a new
operator has to do — get a source indexed, see an answer, put the tag on a
site — is the smallest thing on the page. This replaces that view, until
the widget is live on the operator's own site, with a page that *is* the
guide: a status pill, three numbered steps with the real artifacts inline
(the source form, the ask button, the snippet with its copy buttons, the
origin form), and completion that verifies itself. The same change renames
the settings page the third step lands on from Deploy to Install.

## Reference

The category convention for first-run states is a single page that holds
a status pill for the event being waited on, numbered steps with the
artifacts inline (keys, snippets, copy buttons) rather than links to them,
and automatic verification that swaps the page to the real dashboard once
the event lands. Everything this page needs already exists in the
dashboard; the work is composition, one shared helper, and one small
addition to the model-config module.

## Design

**One page, two branches.** `app/(dashboard)/page.tsx` derives the
onboarding status first (`getOnboardingStatus`, unchanged: every step is
read from live rows, the only stored bit is `projects.onboardingDismissedAt`).
While the project is neither complete nor dismissed it renders
`GettingStarted` and nothing else; otherwise the analytics view as before,
with the existing "your widget is live" banner above it until dismissed.
Neither branch runs the other's queries. The compact checklist card is
gone: its logic moved into the page, its success state into
`onboarding-live-banner.tsx`.

**The pill names the first undone step, in step order.** Derived by a pure
function (`lib/onboarding-stage.ts`) so it is unit-tested and so the page,
the banner and the tests share one truth:

| state | condition (first match wins) | pill |
|---|---|---|
| live | complete | Live on {origin} |
| no-source | no source row | Waiting for your docs |
| indexing | no ready source, one syncing | Indexing… |
| source-error | no ready source, none syncing | Crawl failed |
| unasked | ready, no assistant message yet | Waiting for the first question |
| not-installed | asked, no allowed origin, no foreign install | Ready to install |
| listening | asked, origin allowed, no foreign install | Listening for your widget |

Two of these are not obvious. "Crawl failed" exists because the page must
not say "Indexing…" over a source that stopped; and "Ready to install"
exists because "Listening for your widget" before any origin is allowed
would be a claim about a beacon nothing can send — in production a project
with an empty allowlist is refused outright. A project that has answers
but no source (possible with a headless client) reads "Waiting for your
docs", not "Ready to install": the steps are ordered by what the operator
should do next, not by what happens to be true.

**Artifacts inline, forms reused.** Step 1 renders the Sources page's
`AddSourceForm` and the same server action; the action now also
revalidates `/`, without which the form appears to do nothing — the
refresh poller is not mounted before a source exists. Progress is
"Indexing… N pages so far" from a count of `documents` per source, which
the worker writes one page at a time, so the number moves during a crawl.
No target is shown: there is no column for it and the crawler stops at
`maxPages` on its own. Step 2 is the existing ask button (the dashboard
mounts the widget once in its layout; the button dispatches the open
event), disabled until a source is ready, and once an assistant message
exists it shows the first question with how many sources the answer
cited — or, for a refusal, that the agent declined rather than guessed,
which is the product working. Step 3 renders the one-tag snippet with a
copy button, a second button that copies a prompt for a coding agent, the
Install page's add-origin form (extracted to `add-origin-form.tsx` so both
pages render one component), and the listening / verified state in the
words the Install page already uses. When the deployment refuses
unconfigured projects (production without `DESKBELL_ALLOW_ANY_ORIGIN`) the
step says the origin is required, not recommended. The deployment's own
origin is refused by the add-origin action with an explanation, and an
allowlist that holds only that origin does not count as "origin allowed":
it is always allowed anyway, and its widget never counts as an install, so
the step would otherwise listen for a beacon that by design never arrives
(found on the first live walk, 2026-09-14).

**One snippet builder.** The Install page built the script tag and the
manual element inline. Both move to `lib/widget-snippet.ts`, pure and
unit-tested, and the Overview imports the same functions, so the two pages
cannot render different tags. The coding-agent prompt lives there too. It
carries the snippet itself, the CSP note (allow the deployment origin in
`script-src` and `connect-src`), a warning not to add the tag twice or
alongside a manual element, the allowlist requirement, and the install
docs URL — enough that no separate skill or package is needed for an agent
to do the job.

**Model keys, presence only.** A self-hosted instance has a step the
hosted products do not: the model provider. `modelProviderStatus()` in the
model-config module (the only module allowed to read provider
environment, root rule 8) reports for the configured chat and embedding
models whether their provider needs a key and whether that variable is
set. The page shows a warning above the steps only when one is missing,
naming the variable and linking to the models docs. It is a presence
check, never a validity check: probing a key costs money and latency on
every page load, and a rejected key already surfaces where it fails — the
embed step, which leaves the source in `syncing`. Step 1 says to check the
worker logs when syncing outlasts a few minutes, because that is the one
failure the pill cannot name.

**Roles.** Editors add sources and may skip the guide (the existing
`dismissOnboarding`); admins also allow origins; viewers see every step
read-only with a line saying who does it, and a link to Conversations so
they are not parked on a page they cannot advance. Gating uses the role
the layout already resolves (`requireMember`, request-cached); the server
actions keep their own checks.

**Live updates.** The existing `AutoRefresh` is mounted under the same
rule as the old checklist: while indexing, while waiting for the first
answer, while an allowed origin has not reported in. Nothing polls once
nothing can change without the operator.

**Deploy becomes Install.** In a self-hosted product "deploy" means the
server — the docs use it that way throughout — while the page is about
getting the widget onto a site. The route moves to `/settings/install`.
The old URLs are not redirected: nothing public ever linked to them, and
the pre-1.0 redirect for `/deploy` goes with them. The sidebar and palette
label change; the icon stays, the primary artifact is still a snippet. Copy that
named the page changes with it (dashboard, README, roadmap, docs). Not
renamed: the `deploy` permission statement in the access-control
definition (internal, no user ever sees it) and the breadcrumb `spec:
single-tag-embed-deploy-onboarding` in code comments (a filename, not a
label).

## Non-goals

- Opening the widget with a prefilled question. The widget's JS API has
  `ask(question)`; the step keeps the plain open event, and a suggested
  question is a widget-appearance setting the operator already controls.
- Probing whether a model key is valid.
- A page-count target or a progress bar for the crawl.
- Framework-specific install instructions; those belong on the install
  docs page, not the dashboard.
- Letting viewers dismiss the guide.
- Renaming the `deploy` permission key or the earlier spec's filename.

## Open questions

- Whether "Skip to overview" should be reachable before a source exists.
  It is today (an operator evaluating the dashboard on an empty project
  should not be trapped), at the cost of a skipped project never showing
  the guide again.

## Verify

- Unit: `lib/onboarding-stage.test.ts` covers every row of the table and
  the out-of-order case; `lib/widget-snippet.test.ts` pins the tag, the
  manual element and the agent prompt; `packages/core` tests
  `modelProviderStatus` for a missing key, a blank key, a mixed pair of
  providers, a local provider and an unknown one.
- Browser: `e2e/overview.spec.ts` walks the guide in the seeded state
  (answers exist, no source, empty allowlist): the guide renders and the
  stat cards do not; the pill reads "Waiting for your docs"; the snippet
  carries the project key; the model-key warning names `OPENAI_API_KEY`
  (the test server pins the model env so a developer's real key cannot
  hide it); inserting a ready source unlocks the ask button and moves the
  pill to "Ready to install"; the phone width never scrolls sideways; skip
  swaps to the analytics view. `e2e/settings-install.spec.ts` opens the
  renamed page. The viewer-only rendering has no browser
  test: the suite has one account and it is the owner.
- Manual: a fresh seed → submit a small docs URL → watch the count move →
  ask → proof → allow an origin → load a page there → banner over
  analytics → Done. Then: unset the key and reload; sign in as a viewer;
  visit `/deploy` and `/settings/deploy`; run the production build with an
  empty allowlist and confirm step 3 says required; browse the dashboard
  on `localhost` and on `127.0.0.1` and confirm the dashboard's own widget
  never completes step 3.
