"use client";

import { ACTION_LIMITS, type ActionPolicy } from "@deskbell/shared";
import { Badge } from "@deskbell/ui/components/badge";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { toast } from "@deskbell/ui/components/sonner";
import { ToggleGroup, ToggleGroupItem } from "@deskbell/ui/components/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@deskbell/ui/components/tooltip";
import { useRef, useState, useTransition } from "react";

import type { ToolView } from "@/lib/actions/settings";
import { setLabel, setPolicy } from "./actions";

/**
 * The two controls a tool has, wherever it is listed (spec: actions-ia):
 * the policy switch and the visitor-facing label. Both save the moment
 * they change and confirm through a toast, so the tools table, the server
 * page and the tool page behave the same.
 */
export const POLICY_LABEL: Record<ActionPolicy, string> = {
  off: "Off",
  allow: "Allowed",
  confirm: "Needs confirmation",
};

const HINTS: Array<{ key: "destructive" | "openWorld"; label: string; help: string }> = [
  {
    key: "destructive",
    label: "destructive",
    help: "The server says this tool may delete or overwrite. Have the visitor confirm it.",
  },
  {
    key: "openWorld",
    label: "open world",
    help: "The server says this tool reaches beyond its own system, such as the public web.",
  },
];

/** The server's hints about a tool, as badges with an explanation on hover. */
export function HintBadges({ tool }: { tool: Pick<ToolView, "destructive" | "openWorld"> }) {
  const hints = HINTS.filter((h) => tool[h.key]);
  if (hints.length === 0) return null;
  return (
    <TooltipProvider>
      {hints.map((h) => (
        <Tooltip key={h.key}>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-help text-muted-foreground" tabIndex={0}>
              {h.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{h.help}</TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  );
}

/**
 * The three-way switch. Controlled when a parent passes `onChange` (the
 * server page keeps every policy to know when all are off), self-managed
 * otherwise (the tools table, the tool page). A failed save puts the
 * previous value back and says why.
 */
export function PolicyControl({
  serverId,
  tool,
  policy,
  onChange,
  canEdit,
  showSuggestion = true,
}: {
  serverId: string;
  tool: Pick<ToolView, "name" | "suggested">;
  policy: ActionPolicy;
  onChange?: (policy: ActionPolicy) => void;
  canEdit: boolean;
  showSuggestion?: boolean;
}) {
  const [own, setOwn] = useState(policy);
  const [saving, startSave] = useTransition();
  const value = onChange ? policy : own;
  const set = (next: ActionPolicy) => (onChange ? onChange(next) : setOwn(next));

  const choose = (raw: string) => {
    // Radix reports "" when the active item is clicked again; nothing changed.
    if (!raw || raw === value) return;
    const next = raw as ActionPolicy;
    const previous = value;
    set(next);
    startSave(async () => {
      const result = await setPolicy(serverId, tool.name, next);
      if (result.error) {
        set(previous);
        toast.error(`Could not save ${tool.name}`, { description: result.error });
        return;
      }
      toast.success(`${tool.name}: ${POLICY_LABEL[next]}`, {
        description: "Applies to the next question.",
      });
    });
  };

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={choose}
        disabled={!canEdit || saving}
        aria-label={`Policy for ${tool.name}`}
        data-testid={`${serverId}-${tool.name}`}
      >
        <ToggleGroupItem value="off">{POLICY_LABEL.off}</ToggleGroupItem>
        <ToggleGroupItem value="allow">{POLICY_LABEL.allow}</ToggleGroupItem>
        <ToggleGroupItem value="confirm">{POLICY_LABEL.confirm}</ToggleGroupItem>
      </ToggleGroup>
      {showSuggestion && value === "off" ? (
        <p className="text-xs text-muted-foreground">Suggested: {POLICY_LABEL[tool.suggested]}</p>
      ) : null}
    </div>
  );
}

/**
 * What the widget calls the tool while it runs and on its confirmation
 * card. Saved when the field is left, so typing costs nothing and a
 * change is one request; Enter saves too, without submitting anything.
 * The field stays enabled while saving: disabling it would blur it and
 * fire a second save, so an in-flight value is remembered instead.
 */
export function LabelField({
  tool,
  serverId,
  canEdit,
}: {
  tool: Pick<ToolView, "name" | "title" | "label">;
  serverId: string;
  canEdit: boolean;
}) {
  const [saved, setSaved] = useState(tool.label);
  const [saving, startSave] = useTransition();
  const inFlight = useRef<string | null>(null);
  const id = `${serverId}-${tool.name}-label`;

  const commit = (raw: string) => {
    const next = raw.trim().slice(0, ACTION_LIMITS.label);
    if (next === saved || next === inFlight.current) return;
    inFlight.current = next;
    startSave(async () => {
      const result = await setLabel(serverId, tool.name, next);
      inFlight.current = null;
      if (result.error) {
        toast.error(`Could not save the label for ${tool.name}`, { description: result.error });
        return;
      }
      setSaved(next);
      toast.success(
        next ? `${tool.name}: shown as “${next}”` : `${tool.name}: shown as “${tool.title}”`,
        { description: "Applies to the next question." },
      );
    });
  };

  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Shown to visitors as
      </Label>
      <Input
        id={id}
        defaultValue={tool.label}
        placeholder={tool.title}
        maxLength={ACTION_LIMITS.label}
        aria-label={`Label for ${tool.name}`}
        autoComplete="off"
        disabled={!canEdit}
        aria-busy={saving}
        className="h-8 text-sm"
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
      />
    </div>
  );
}
