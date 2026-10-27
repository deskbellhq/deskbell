"use client";

import type { Topic } from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ContextValues } from "@/lib/conversations-list";
import {
  type ConversationsView,
  conversationsHref,
  FEEDBACK_KEYS,
  FEEDBACK_LABELS,
  INTENT_KEYS,
  OUTCOME_KEYS,
  OUTCOME_LABELS,
  SIGNAL_KEYS,
} from "@/lib/conversations-view";

/**
 * The one way to add a narrowing to the inbox (spec: attention-inbox): a
 * menu of properties, each opening the values the project knows. Picking a
 * value navigates; the chip above the list is the way back. Properties with
 * nothing to offer — a project without topics, a host that sends no context
 * — are left out rather than shown empty.
 */
export function ConversationsFilterMenu({
  view,
  topics,
  contextValues,
  intentNames,
  signalNames,
}: {
  view: ConversationsView;
  topics: readonly Topic[];
  contextValues: ContextValues[];
  /** The fixed lists' display names, keyed as the URL spells them. */
  intentNames: Record<string, string>;
  signalNames: Record<string, string>;
}) {
  const router = useRouter();
  const go = (next: Partial<ConversationsView>) =>
    router.push(conversationsHref("/conversations", { ...view, ...next }));

  const groups: Array<{
    name: string;
    values: Array<{ key: string; label: string; next: Partial<ConversationsView> }>;
  }> = [
    {
      name: "Outcome",
      values: OUTCOME_KEYS.map((k) => ({ key: k, label: OUTCOME_LABELS[k], next: { outcome: k } })),
    },
    {
      name: "Feedback",
      values: FEEDBACK_KEYS.map((k) => ({
        key: k,
        label: FEEDBACK_LABELS[k],
        next: { feedback: k },
      })),
    },
    {
      name: "Intent",
      values: INTENT_KEYS.map((k) => ({ key: k, label: intentNames[k] ?? k, next: { intent: k } })),
    },
    {
      name: "Signal",
      values: SIGNAL_KEYS.map((k) => ({ key: k, label: signalNames[k] ?? k, next: { signal: k } })),
    },
    ...(topics.length > 0
      ? [
          {
            name: "Topic",
            values: topics.map((t) => ({ key: t.key, label: t.name, next: { topic: t.key } })),
          },
        ]
      : []),
    ...contextValues.map((c) => ({
      name: c.key,
      values: c.values.map((v) => ({
        key: v.id,
        label: v.name ?? v.id,
        next: { context: { key: c.key, id: v.id } },
      })),
    })),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 shrink-0 px-0"
          aria-label="Filter"
          title="Add a filter"
        >
          <Plus className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {groups.map((group) => (
          <DropdownMenuSub key={group.name}>
            <DropdownMenuSubTrigger className="text-xs">{group.name}</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                {group.values.map((value) => (
                  <DropdownMenuItem
                    key={value.key}
                    className="text-xs"
                    onSelect={() => go(value.next)}
                  >
                    <span className="truncate">{value.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
