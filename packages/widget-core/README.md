# @deskbell/widget

The Deskbell widget as a custom element: a launcher, a panel that streams
answers with their sources, feedback thumbs and the visitor's previous
conversations. Rendered in a shadow root, so your page's CSS stays out of it
and its CSS stays out of your page.

Use this package when your application bundles its own JavaScript. A plain site
loads `deskbell.js` from your Deskbell server instead, with one script tag; see
[Install](https://deskbell.dev/docs/widget/install).

## Install

```bash
npm install @deskbell/widget
```

ES module, `preact` is the only dependency, MIT licensed.

## Use

```ts
import { register } from "@deskbell/widget";

register();
```

`register` defines `<deskbell-widget>`. Place the element where you want the
launcher, with your project key and the origin of your Deskbell server:

```html
<deskbell-widget
  project-key="pk_live_..."
  api-url="https://your-deskbell.example.com"
></deskbell-widget>
```

`api-url` is required here: a package knows nothing about your server. The
project key is visible in page source and is not a secret; the server only
answers origins on the project's allowlist.

The element's methods are the API: `open()`, `close()`, `toggle()`,
`ask(question)` and `configure(patch)`. There is no loader, no `window.deskbell`
stub and no auto-mount in this package.

## Customise

Four layers, each an escape hatch for the one below:

1. Attributes on the element, one per option.
2. `--deskbell-*` CSS custom properties for colours, radii and sizes.
3. `::part()` selectors on every structural element, for shape and layout.
4. Named slots (`launcher`, `header`, `empty-state`, `footer`) to replace markup.

Host-page CSS always wins over anything configured at runtime.
[Options](https://deskbell.dev/docs/widget/configuration) lists every attribute,
[Theming](https://deskbell.dev/docs/widget/configuration/theming) the tokens,
parts and slots, and
[JavaScript API](https://deskbell.dev/docs/widget/javascript-api) the commands
and the `deskbell:*` events the widget dispatches.

## Related packages

- [`@deskbell/widget-react`](https://www.npmjs.com/package/@deskbell/widget-react)
  wraps this element as a React component.
- [`@deskbell/sdk`](https://www.npmjs.com/package/@deskbell/sdk) is the typed
  client the widget runs on, for a UI of your own.

## Links

- [Documentation](https://deskbell.dev/docs/widget)
- [Source](https://github.com/deskbellhq/deskbell/tree/main/packages/widget-core)
- [Changelog](https://github.com/deskbellhq/deskbell/blob/main/packages/widget-core/CHANGELOG.md)
