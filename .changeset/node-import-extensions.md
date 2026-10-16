---
"@deskbell/widget": patch
"@deskbell/widget-react": patch
"@deskbell/sdk": patch
"@deskbell/shared": patch
---

Relative imports in the published files now carry their `.js` extension, so
`@deskbell/sdk` and `@deskbell/shared` load under plain Node as well as under a
bundler. 0.1.0 failed with "Cannot find module" when imported from Node directly.
