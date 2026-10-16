import {
  DEFAULTS,
  PARTS,
  SLOTS,
  TOKENS,
  WIDGET_OPTIONS,
  type WidgetOption,
} from "@deskbell/shared/widget-config";
import {
  type OptionGroup,
  TOKEN_HELP,
  WIDGET_OPTION_META,
} from "@deskbell/shared/widget-config-meta";

/**
 * The widget reference, rendered from the descriptor the widget itself reads.
 *
 * `packages/shared/src/widget-config.ts` is the single source of truth for the
 * widget, the snippet loader, the React wrapper, the dashboard editor and the
 * database schema. These tables read the same objects, so a documented option
 * the widget does not have is not a thing that can happen. There is nothing to
 * regenerate and nothing to check.
 *
 * `docs/widget-customization.md` is a separate, generated artifact for people
 * reading a checkout instead of this site. It is not involved here.
 */

function typeOf(option: WidgetOption): string {
  if (option.kind === "enum") return option.values?.join(" | ") ?? "";
  if (option.kind === "stringList") return `list, max ${option.max}`;
  if (option.kind === "theme" || option.kind === "copy") return "object";
  if (option.kind === "promptGroups" || option.kind === "reasons") return "JSON array";
  if (option.kind === "int") return "number";
  if (option.kind === "css") return "CSS value";
  return option.kind;
}

function defaultOf(key: string): string {
  const value = DEFAULTS[key as keyof typeof DEFAULTS];
  if (value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join("|") : "—";
  if (typeof value === "object") return "—";
  return String(value);
}

function Code({ children }: { children: string }) {
  return <code>{children}</code>;
}

export function WidgetOptions({ group }: { group: OptionGroup }) {
  const rows = WIDGET_OPTIONS.filter((option) => WIDGET_OPTION_META[option.key].group === group);

  if (rows.length === 0) return null;

  return (
    <table>
      <thead>
        <tr>
          <th>Attribute</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((option) => (
          <tr key={option.key}>
            <td>
              <Code>{option.attr}</Code>
            </td>
            <td>{typeOf(option)}</td>
            <td>{defaultOf(option.key) === "—" ? "—" : <Code>{defaultOf(option.key)}</Code>}</td>
            <td>{WIDGET_OPTION_META[option.key].help}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ThemeTokens() {
  return (
    <table>
      <thead>
        <tr>
          <th>Custom property</th>
          <th>Controls</th>
        </tr>
      </thead>
      <tbody>
        {TOKENS.map((token) => (
          <tr key={token}>
            <td>
              <Code>{`--deskbell-${token}`}</Code>
            </td>
            <td>{TOKEN_HELP[token]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WidgetParts() {
  return (
    <ul>
      {PARTS.map((part) => (
        <li key={part}>
          <Code>{`::part(${part})`}</Code>
        </li>
      ))}
    </ul>
  );
}

export function WidgetSlots() {
  return (
    <ul>
      {SLOTS.map((slot) => (
        <li key={slot}>
          <Code>{`slot="${slot}"`}</Code>
        </li>
      ))}
    </ul>
  );
}
