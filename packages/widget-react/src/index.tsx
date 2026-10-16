"use client";

import type { WidgetConfig } from "@deskbell/shared/widget-config";
import { WIDGET_OPTIONS } from "@deskbell/shared/widget-config";
import type { DeskbellWidget } from "@deskbell/widget";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Every widget option, in React casing. Derived from the same descriptor the
 * custom element parses attributes with, so this can never drift.
 */
export type DeskbellProps = Partial<Omit<WidgetConfig, "projectKey">> & {
  projectKey: string;
  /** Imperative handle: open/close/toggle/ask/configure. */
  ref?: Ref<DeskbellHandle>;
  /** Light-DOM children for the launcher/header/empty-state/footer slots. */
  children?: React.ReactNode;
  /** Rewrites an answer's Markdown before it renders. Must be pure. */
  answerTransform?: (markdown: string) => string;
  /** The signed-in visitor's bearer token, asked for before every request. */
  getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>;
};

export interface DeskbellHandle {
  open(): void;
  close(): void;
  toggle(): void;
  ask(question: string): void;
}

/** camelCase prop → kebab-case attribute, straight off the descriptor. */
const ATTR_BY_KEY = new Map(WIDGET_OPTIONS.map((o) => [o.key as string, o.attr]));

function toAttributes(props: DeskbellProps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    const attr = ATTR_BY_KEY.get(key);
    if (!attr || value === undefined || value === null) continue;
    if (typeof value === "boolean") out[attr] = String(value);
    else if (Array.isArray(value)) out[attr] = value.join("|");
    else if (typeof value === "object") out[attr] = JSON.stringify(value);
    else out[attr] = String(value);
  }
  return out;
}

/**
 * React wrapper around the <deskbell-widget> custom element.
 *
 * Styling still goes through CSS — `--deskbell-*` custom properties, `::part()`
 * and slots — not through props. See docs/widget-customization.md.
 */
export function Deskbell({
  ref,
  children,
  answerTransform,
  getAuthToken,
  ...props
}: DeskbellProps) {
  const elementRef = useRef<DeskbellWidget | null>(null);

  useEffect(() => {
    void import("@deskbell/widget").then(({ register }) => register());
  }, []);

  useEffect(() => {
    if (elementRef.current) elementRef.current.answerTransform = answerTransform;
  }, [answerTransform]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.getAuthToken = getAuthToken;
  }, [getAuthToken]);

  useImperativeHandle(ref, () => ({
    open: () => elementRef.current?.open(),
    close: () => elementRef.current?.close(),
    toggle: () => elementRef.current?.toggle(),
    ask: (question: string) => elementRef.current?.ask(question),
  }));

  return (
    <deskbell-widget ref={elementRef} {...toAttributes(props)}>
      {children}
    </deskbell-widget>
  );
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "deskbell-widget": React.DetailedHTMLProps<
        React.HTMLAttributes<DeskbellWidget>,
        DeskbellWidget
      > &
        Record<string, unknown>;
    }
  }
}
