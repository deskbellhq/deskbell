# Register and login pages

Date: 2026-08-26 · Status: shipped · Amends: 2026-08-25-dashboard-auth

## Decision

Split first-run setup out of `/login` into a dedicated `/register` page and
give both auth pages the conventional centered layout: brand, large page
title, card with the form, primary action, and a cross-link to the other
page.

## Shape

- `/register` renders the "Create new account" form (name, email, password)
  unconditionally; `closedSignupGate` stays the sole authority on whether the
  submission is allowed (first user, invited email, or 403). The page only
  varies its helper copy: on first run it explains the owner seat, afterwards
  it says sign-up is invitation-only and points at the invite link, because a
  raw sign-up with an invited email creates a membership-less account — the
  accept-invitation page is the path that also grants the member row.
- `/login` is sign-in only and redirects to `/register` while the instance
  has zero users. Both checks are presentation; the gate enforces the policy
  on the API whatever the pages render.
- Cross-links: `/register` → "Already have an account? Sign in";
  `/login` → "No account yet? Sign up".
- No forgot-password link: v1 has no outbound email path, so recovery remains
  the operator action documented in the production checklist. Adding the link
  without the path behind it would be a dead end.
- `PasswordInput` wraps `Input` with a show/hide toggle for the auth forms.
- `proxy.ts` needs no change: its matcher enumerates dashboard paths, so
  `/register` is public by construction, like `/login` and
  `/accept-invitation`.

## Ruled out

- Hiding the register form when sign-up is closed: the page would have to
  duplicate the gate's decision (user count + pending-invitation lookup) and
  would go stale the moment an invitation is created or revoked. Showing the
  form and letting the gate answer keeps one authority.
- A shared actions module for sign-in and sign-up: `"use server"` files may
  only export async functions, so the shared bits (`AuthFormState`,
  `authErrorMessage`) moved to `lib/auth/form-state.ts` instead and each
  route keeps its own action file.

## Where it bites

`apps/web/app/register/`, `apps/web/app/login/`,
`apps/web/components/{auth-shell,register-form,login-form,password-input}.tsx`
(`setup-form.tsx` deleted), `apps/web/lib/auth/form-state.ts`, and the
self-hosting docs that previously named `/login` as the first-run page.
