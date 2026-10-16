"use client";

import type { WidgetAppearance } from "@deskbell/shared/widget-config";
import { DEFAULTS, WIDGET_OPTIONS } from "@deskbell/shared/widget-config";
import { type OptionGroup, WIDGET_OPTION_META } from "@deskbell/shared/widget-config-meta";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { Separator } from "@deskbell/ui/components/separator";
import { Switch } from "@deskbell/ui/components/switch";
import { useActionState, useEffect, useState } from "react";

import { saveAppearance } from "./actions";

/**
 * The Appearance editor.
 *
 * Every control is generated from WIDGET_OPTION_META, so adding a widget
 * option never means touching this file — that is the whole point of keeping
 * one descriptor. The preview is the real widget already embedded in the
 * dashboard, driven through its public `configure()` API: what you see in the
 * corner is literally what a visitor gets.
 *
 * Layout is one settings column, Notion-style: a section header per option
 * group, then one row per option — name and help on the left, the control on
 * the right.
 */

const GROUPS: OptionGroup[] = ["Theme", "Launcher", "Behaviour", "Content"];
const EDITABLE = WIDGET_OPTIONS.filter(
  (o) => !o.clientOnly && WIDGET_OPTION_META[o.key].control !== "hidden",
);

type Draft = Record<string, unknown>;

type PreviewWidget = { configure?: (patch: Draft) => void; open?: () => void };

/** "bottom-right" → "Bottom right" — display only, the stored value is untouched. */
const prettyValue = (v: string) => (v.charAt(0).toUpperCase() + v.slice(1)).replace(/-/g, " ");

export function AppearanceEditor({ appearance }: { appearance: Partial<WidgetAppearance> }) {
  const [draft, setDraft] = useState<Draft>(appearance as Draft);
  const [state, action, pending] = useActionState(saveAppearance, undefined);

  // Live preview: push the draft into the widget in the corner of this page.
  // The bundle is lazy-loaded, so on first paint the element is still an
  // un-upgraded HTMLElement with no configure() — re-apply once it upgrades.
  // Missing keys are sent as explicit defaults: configure() merges, so an
  // omitted key would leave the previous value stuck in the preview after a
  // field is cleared or the form reset.
  useEffect(() => {
    let cancelled = false;
    const patch: Draft = {};
    for (const option of EDITABLE) {
      patch[option.key] = draft[option.key] ?? DEFAULTS[option.key];
    }
    const apply = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>("deskbell-widget") as PreviewWidget | null;
      el?.configure?.(patch);
    };
    apply();
    void customElements.whenDefined("deskbell-widget").then(apply);
    return () => {
      cancelled = true;
    };
  }, [draft]);

  // Editing appearance with the panel shut shows nothing, so open the preview
  // on arrival. Once, not per change: the launcher options are visible exactly
  // while the panel is closed, so reopening would fight anyone styling it.
  // open() buffers until the panel is live, so this cannot race the upgrade.
  useEffect(() => {
    let cancelled = false;
    void customElements.whenDefined("deskbell-widget").then(() => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>("deskbell-widget") as PreviewWidget | null;
      el?.open?.();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: string, value: unknown) =>
    setDraft((prev) => {
      const next = { ...prev };
      if (value === "" || value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  // max-w-2xl, not 3xl: the open preview panel is ~400px of fixed overlay on
  // the right, and the controls must stay clear of it on a laptop screen.
  return (
    <form action={action} className="flex w-full max-w-2xl flex-col gap-12">
      <input type="hidden" name="appearance" value={JSON.stringify(draft)} />

      {GROUPS.map((group) => {
        const options = EDITABLE.filter((o) => WIDGET_OPTION_META[o.key].group === group);
        if (options.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="text-base font-semibold tracking-tight">{group}</h2>
            <Separator className="mt-3 mb-6" />
            <FieldGroup>
              {options.map((option) => {
                const meta = WIDGET_OPTION_META[option.key];
                const value = draft[option.key];
                const fallback = DEFAULTS[option.key];
                const id = `opt-${option.key}`;
                return (
                  <Field
                    key={option.key}
                    orientation={meta.control === "list" ? "vertical" : "horizontal"}
                  >
                    <FieldContent>
                      <FieldLabel htmlFor={id}>{meta.label}</FieldLabel>
                      <FieldDescription>{meta.help}</FieldDescription>
                    </FieldContent>
                    {meta.control === "select" ? (
                      <Select
                        value={String(value ?? fallback)}
                        onValueChange={(v) => set(option.key, v)}
                      >
                        <SelectTrigger id={id} className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {option.values?.map((v) => (
                            <SelectItem key={v} value={v}>
                              {prettyValue(v)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : meta.control === "switch" ? (
                      <Switch
                        id={id}
                        checked={value === undefined ? Boolean(fallback) : Boolean(value)}
                        onCheckedChange={(checked) => set(option.key, checked)}
                      />
                    ) : meta.control === "color" ? (
                      <div className="flex w-56 shrink-0 gap-2">
                        <Input
                          aria-label={`${meta.label} swatch`}
                          type="color"
                          className="h-9 w-12 shrink-0 p-1"
                          value={String(value ?? fallback)}
                          onChange={(e) => set(option.key, e.currentTarget.value)}
                        />
                        <Input
                          id={id}
                          value={String(value ?? "")}
                          placeholder={String(fallback)}
                          onChange={(e) => set(option.key, e.currentTarget.value)}
                        />
                      </div>
                    ) : meta.control === "list" ? (
                      <Input
                        id={id}
                        value={Array.isArray(value) ? value.join(" | ") : ""}
                        placeholder="Separate with |"
                        onChange={(e) =>
                          set(
                            option.key,
                            e.currentTarget.value
                              .split("|")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    ) : meta.control === "number" ? (
                      <Input
                        id={id}
                        type="number"
                        className="w-24 shrink-0"
                        value={value === undefined ? "" : String(value)}
                        placeholder={String(fallback ?? "")}
                        onChange={(e) =>
                          set(
                            option.key,
                            e.currentTarget.value === ""
                              ? undefined
                              : Number(e.currentTarget.value),
                          )
                        }
                      />
                    ) : (
                      <Input
                        id={id}
                        className="w-56 shrink-0"
                        value={value === undefined ? "" : String(value)}
                        placeholder={String(fallback ?? "")}
                        onChange={(e) => set(option.key, e.currentTarget.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </FieldGroup>
          </section>
        );
      })}

      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t bg-background py-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save appearance"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setDraft({})}>
          Reset to defaults
        </Button>
        {state?.error ? (
          <span className="text-sm text-destructive">{state.error}</span>
        ) : state?.savedAt ? (
          <span className="text-sm text-muted-foreground">Saved — live for every visitor.</span>
        ) : null}
      </div>
    </form>
  );
}
