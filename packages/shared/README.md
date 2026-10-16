# @deskbell/shared

The wire contracts shared by the Deskbell server, widget and SDK: request and
event schemas, the widget's configuration descriptor, and the Markdown parser
answers are rendered with. MIT licensed.

You rarely install this package directly.
[`@deskbell/sdk`](https://www.npmjs.com/package/@deskbell/sdk) and
[`@deskbell/widget`](https://www.npmjs.com/package/@deskbell/widget) depend on
it and re-export the types a consumer needs. Reach for it when you build a UI of
your own and want the schemas or the descriptor by value.

## Install

```bash
npm install @deskbell/shared
```

## Entry points

| Import | Contents | Depends on |
|---|---|---|
| `@deskbell/shared` | Zod schemas and types for every public endpoint: `AskRequest`, `AnswerEvent`, `Citation`, `WidgetMessage`, `FeedbackRequest`, visitor identity and more | `zod` |
| `@deskbell/shared/widget-config` | The widget option descriptor (`WIDGET_OPTIONS`), its tokens, parts, copy keys and the attribute parser | nothing |
| `@deskbell/shared/widget-config-meta` | Labels, help text and grouping for each widget option | nothing |
| `@deskbell/shared/markdown` | A dependency-free Markdown parser that produces a tree, never HTML, so nothing a model writes is interpreted as markup | nothing |
| `@deskbell/shared/source-types` | Source type strings a browser needs by value | nothing |

```ts
import type { AnswerEvent, Citation } from "@deskbell/shared";
import { WIDGET_OPTIONS } from "@deskbell/shared/widget-config";
import { parseMarkdown } from "@deskbell/shared/markdown";
```

The root entry pulls in `zod`; the subpath entries have no imports at all, which
is what lets the widget inline them inside its size budget.

## Links

- [API reference](https://deskbell.dev/docs/developer/api)
- [Source](https://github.com/deskbellhq/deskbell/tree/main/packages/shared)
- [Changelog](https://github.com/deskbellhq/deskbell/blob/main/packages/shared/CHANGELOG.md)
