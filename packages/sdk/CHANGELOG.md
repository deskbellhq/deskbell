# @deskbell/sdk

## 0.2.0

### Patch Changes

- Updated dependencies [29b3fc8]
  - @deskbell/shared@0.2.0

## 0.1.2

### Patch Changes

- 30cf212: Ship a README with each package, and point `repository`, `homepage` and `bugs`
  at the source and the docs.
- Updated dependencies [30cf212]
  - @deskbell/shared@0.1.2

## 0.1.1

### Patch Changes

- 0a47eec: Relative imports in the published files now carry their `.js` extension, so
  `@deskbell/sdk` and `@deskbell/shared` load under plain Node as well as under a
  bundler. 0.1.0 failed with "Cannot find module" when imported from Node directly.
- Updated dependencies [0a47eec]
  - @deskbell/shared@0.1.1

## 0.1.0

### Minor Changes

- c2e2fe8: First publishable versions. The widget installs from npm as `@deskbell/widget`,
  the SDK wraps every public endpoint, and the widget runs on it.

### Patch Changes

- Updated dependencies [c2e2fe8]
  - @deskbell/shared@0.1.0
