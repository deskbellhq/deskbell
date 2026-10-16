# Changesets

The four MIT packages (`@deskbell/widget`, `@deskbell/widget-react`,
`@deskbell/sdk`, `@deskbell/shared`) version together. A change to any of them
ships with a changeset:

```
pnpm changeset
```

Releases are cut with `pnpm changeset version` followed by `pnpm release`, or
by dispatching the Release workflow. Private packages are never published.
