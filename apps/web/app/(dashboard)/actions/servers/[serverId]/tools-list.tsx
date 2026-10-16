"use client";

import type { ActionPolicy } from "@deskbell/shared";
import { Alert, AlertDescription, AlertTitle } from "@deskbell/ui/components/alert";
import { Button } from "@deskbell/ui/components/button";
import { toast } from "@deskbell/ui/components/sonner";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { groupTools, type ToolView } from "@/lib/actions/settings";
import { applySuggestedPolicies } from "../../actions";
import { HintBadges, LabelField, PolicyControl } from "../../tool-fields";

/**
 * The tools of one server (spec: actions-settings-ui), under two headings:
 * lookups (read-only by the server's own account) and actions. A row per tool with
 * its title, name, the server's hints, the description the model reads,
 * the label the visitor sees (spec: action-presentation) and a three-way
 * switch. The switch saves the moment it is set; the label saves when the
 * field is left. Rows, not a table, so the description has the width it
 * needs and a phone stacks the controls below it.
 */
export function ToolsList({
  serverId,
  tools,
  lastError,
  canEdit,
}: {
  serverId: string;
  tools: ToolView[];
  lastError: string | null;
  canEdit: boolean;
}) {
  const [policies, setPolicies] = useState<Record<string, ActionPolicy>>(() =>
    Object.fromEntries(tools.map((t) => [t.name, t.policy])),
  );
  const [applying, startApply] = useTransition();

  if (tools.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {lastError
          ? "No tools listed: the server could not be reached. Fix the connection below or refresh."
          : "No tools listed yet. Refresh tools to ask the server."}
      </p>
    );
  }

  const allOff = tools.every((t) => (policies[t.name] ?? "off") === "off");
  const { lookups, actions } = groupTools(tools);
  const rows = (group: ToolView[]) =>
    group.map((tool) => (
      <ToolRow
        key={tool.name}
        tool={tool}
        serverId={serverId}
        policy={policies[tool.name] ?? "off"}
        onChange={(policy) => setPolicies((p) => ({ ...p, [tool.name]: policy }))}
        canEdit={canEdit}
      />
    ));

  const applySuggested = () =>
    startApply(async () => {
      const result = await applySuggestedPolicies(serverId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPolicies(Object.fromEntries(tools.map((t) => [t.name, t.suggested])));
      toast.success("Suggested policies applied", {
        description: "Read-only tools are allowed; the rest need the visitor's confirmation.",
      });
    });

  return (
    <div className="flex flex-col gap-4">
      {allOff && canEdit ? (
        <Alert>
          <Sparkles />
          <AlertTitle>Every tool is off</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Start from the server's hints — read-only tools allowed, everything else needing
              confirmation — or set each one below.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applySuggested}
              disabled={applying}
            >
              {applying ? "Applying…" : "Apply suggested"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {lookups.length > 0 ? (
        <ToolGroup
          title="Lookups"
          description="Read-only by the server's own account: they answer from live data and change nothing. Allowed lets them run without asking."
        >
          {rows(lookups)}
        </ToolGroup>
      ) : null}
      {actions.length > 0 ? (
        <ToolGroup
          title="Actions"
          description="They change something for the visitor. Needs confirmation shows a card the visitor approves before anything runs."
        >
          {rows(actions)}
        </ToolGroup>
      ) : null}
    </div>
  );
}

function ToolGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-col gap-0.5 px-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="divide-y rounded-lg border">{children}</ul>
    </section>
  );
}

function ToolRow({
  tool,
  serverId,
  policy,
  onChange,
  canEdit,
}: {
  tool: ToolView;
  serverId: string;
  policy: ActionPolicy;
  onChange: (policy: ActionPolicy) => void;
  canEdit: boolean;
}) {
  return (
    <li
      id={`tool-${tool.name}`}
      className="flex scroll-mt-20 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/actions/${serverId}/${encodeURIComponent(tool.name)}`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {tool.title}
          </Link>
          {tool.title !== tool.name ? (
            <code className="text-xs text-muted-foreground">{tool.name}</code>
          ) : null}
          <HintBadges tool={tool} />
        </div>
        <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {tool.description || <em>No description — the model is told only the name.</em>}
        </p>
        <div className="mt-3">
          <LabelField tool={tool} serverId={serverId} canEdit={canEdit} />
        </div>
      </div>
      <div className="shrink-0">
        <PolicyControl
          serverId={serverId}
          tool={tool}
          policy={policy}
          onChange={onChange}
          canEdit={canEdit}
        />
      </div>
    </li>
  );
}
