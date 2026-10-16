# Actions settings: a list and a page per server

> Status: shipped · 2026-09-22
> Restructures `/settings/actions` (spec: mcp-actions) from one always-open
> card per server into a list of servers, a page per server, a dialog to
> attach one, and tool policies that save as they are set.

## Problem

The first version of the page rendered every attached server as a full card:
a nine-field connection form, its own Save, a three-column table of tools
with a select each and a second Save for the policies, an unconfirmed Remove,
and a footer of raw URLs. Attaching a server appended another such card. Two
servers already filled several screens; the one control an operator returns
to — a tool's policy — sat below the connection plumbing; a saved change
announced itself with a line of text that stayed until the next reload; and a
stray click on Remove dropped a server and every policy on it.

## Decisions

1. **The page is a list.** One row per server: a status dot, the name, the
   id and host, and a summary of its tools by policy. Rows are links. With
   no server the page shows what attaching one makes possible and the one
   button that does it.
2. **A page per server** at `/settings/actions/[serverId]`, read with the
   same project and organisation scope as every other row (D12); an id from
   another project is a 404. Tools come first, the connection form below a
   rule. The header carries the switch, Refresh tools and a menu with
   Remove server behind a confirmation that says what goes with it.
3. **Attaching is a dialog** with the three fields a first connection needs
   (name, URL, credential) and the id, transport and identity mode behind
   Advanced. Attach saves, discovers and opens the server's page, so the
   first thing an operator sees after attaching is the tools waiting for a
   policy. The dialog and the form share one `ConnectionFields` component.
4. **A policy saves when it is set.** Each tool has a three-way toggle group
   (Off · Allowed · Needs confirmation) that calls `setPolicy` for that one
   tool, optimistically, and confirms in a toast naming the tool and the
   policy. The whole map still goes through `mergePolicies`, so an unknown
   or vanished tool cannot hold a policy. While every tool is off, a callout
   offers **Apply suggested** (`applySuggestedPolicies`): allowed for tools
   the server marks read-only, confirmation for the rest. Tools sit under
   two headings, **Lookups** (read-only by the server's account) and
   **Actions** (the rest), because a lookup and an action are different
   decisions; the read-only badge is therefore not shown, the heading says
   it. Destructive and open-world hints stay as badges.
5. **The switch saves on its own too** (`setServerEnabled`); the connection
   form no longer carries it, and a save of the form keeps the stored value
   rather than re-enabling a server someone switched off.
6. **Toasts** for anything that saves without a Save button. `Toaster` is
   mounted once in the settings shell; `toast` is re-exported from the UI
   package so the app adds no dependency of its own.
7. **Descriptions stay whole.** The description is what the model reads;
   the row gives it the width it needs instead of a table column, and a
   phone stacks the toggle group below it.

## Out of scope

- Editing a tool's description (open question in mcp-actions).
- Per-tool call history on the server page; the audit table has no reader
  yet beyond the conversation view.

## Verify

- `lib/actions/settings.test.ts`: `policySummary` counts, `groupTools` split.
- Playwright `settings-actions.spec.ts`: attach through the dialog with the
  id under Advanced, land on the server page, see Connected, the description,
  the read-only badge and the masked credential (never the secret); set one
  policy, see the toast, reload and find it kept with the other still off;
  the list row summarises the count; remove behind the confirmation and land
  on the empty state.
- Gates: Biome, `next typegen` + typecheck, unit tests, build.
