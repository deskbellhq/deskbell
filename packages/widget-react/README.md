# @deskbell/widget-react

A React component around the Deskbell widget's custom element. Rendering,
styling and behaviour are identical to the script tag and to
[`@deskbell/widget`](https://www.npmjs.com/package/@deskbell/widget): this is a
wrapper, not a React implementation of the UI.

## Install

```bash
npm install @deskbell/widget-react
```

Requires `react` 18 or later as a peer dependency. MIT licensed.

## Use

```tsx
import { Deskbell } from "@deskbell/widget-react";

export function Support() {
  return <Deskbell projectKey="pk_live_..." apiUrl="https://your-deskbell.example.com" />;
}
```

`apiUrl` is required: a package knows nothing about your server. Every widget
option is a prop in camelCase (`apiUrl` for `api-url`, and so on); the mapping
comes from the same descriptor the custom element parses attributes with.

The component is a client component. In Next.js it carries its own
`"use client"` directive, so it can be rendered from a server layout; see
[Next.js](https://deskbell.dev/docs/widget/install/nextjs).

### Controlling it

```tsx
import { Deskbell, type DeskbellHandle } from "@deskbell/widget-react";
import { useRef } from "react";

const widget = useRef<DeskbellHandle>(null);

<Deskbell ref={widget} projectKey="pk_live_..." apiUrl="https://..." />;
<button onClick={() => widget.current?.ask("How do I install the widget?")}>Ask</button>;
```

The handle exposes `open()`, `close()`, `toggle()` and `ask(question)`.

### Other props

- `children`: light-DOM markup for the `launcher`, `header`, `empty-state` and
  `footer` slots, with a `slot` attribute on each child.
- `answerTransform`: rewrites an answer's Markdown before it renders. Must be pure.
- `getAuthToken`: the signed-in visitor's bearer token, asked for before every
  request. See
  [Visitor identity](https://deskbell.dev/docs/widget/identity).

## Customise

Styling still goes through CSS, not props: `--deskbell-*` custom properties,
`::part()` selectors and the named slots.
[Options](https://deskbell.dev/docs/widget/configuration) and
[Theming](https://deskbell.dev/docs/widget/configuration/theming) cover both.

## Links

- [Documentation](https://deskbell.dev/docs/widget/install#react)
- [Source](https://github.com/deskbellhq/deskbell/tree/main/packages/widget-react)
- [Changelog](https://github.com/deskbellhq/deskbell/blob/main/packages/widget-react/CHANGELOG.md)
