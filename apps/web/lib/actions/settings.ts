import {
  ACTION_LIMITS,
  type ActionLabels,
  ActionLabelsSchema,
  type ActionPolicies,
  ActionPoliciesSchema,
  type ActionPolicy,
  type ActionServerConfig,
  type ActionServerInfo,
  ActionServerSchema,
  type ActionToolDefinition,
  actionToolDescription,
  actionToolTitle,
  maskSecret,
  suggestedPolicy,
  validateWebhookUrl,
} from "@deskbell/shared";

import type { ActionServerRow } from "./mcp";

/**
 * The settings page's pure halves (spec: mcp-actions): what the client may
 * see of a stored server, and how a submitted form merges into it. The
 * credential never leaves the server — the view carries a mask, an empty
 * secret field on save keeps what is stored.
 */

export interface ToolView {
  name: string;
  title: string;
  /** Exactly what the model is shown, so the operator can judge it. */
  description: string;
  readOnly: boolean;
  destructive: boolean;
  openWorld: boolean;
  policy: ActionPolicy;
  suggested: ActionPolicy;
  /** What the widget calls the tool; empty when the derived title is used. */
  label: string;
}

/** How many of a server's tools sit at each policy; what the list row summarises. */
export interface PolicySummary {
  total: number;
  allow: number;
  confirm: number;
  off: number;
}

export function policySummary(tools: Pick<ToolView, "policy">[]): PolicySummary {
  const summary: PolicySummary = { total: tools.length, allow: 0, confirm: 0, off: 0 };
  for (const tool of tools) summary[tool.policy] += 1;
  return summary;
}

/**
 * The tools as the page lists them: lookups (the server marks them
 * read-only) apart from actions (everything else), each in the server's
 * order. A lookup and an action are different decisions, so the page
 * shows them under different headings rather than interleaved.
 */
export function groupTools(tools: ToolView[]): { lookups: ToolView[]; actions: ToolView[] } {
  const lookups: ToolView[] = [];
  const actions: ToolView[] = [];
  for (const tool of tools) (tool.readOnly ? lookups : actions).push(tool);
  return { lookups, actions };
}

export interface ServerView {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: ActionServerConfig["transport"];
  authKind: ActionServerConfig["authKind"];
  authHeaderName: string;
  secretMasked: string | null;
  identity: ActionServerConfig["identity"];
  /** The exchange client for `identity: visitor` (spec: visitor-token-actions); empty strings when none. */
  exchangeClientId: string;
  exchangeSecretMasked: string | null;
  exchangeAudience: string;
  exchangeScope: string;
  enabled: boolean;
  status: ActionServerRow["status"];
  lastError: string | null;
  serverInfo: ActionServerInfo | null;
  toolsFetchedAt: string | null;
  tools: ToolView[];
}

export function toolView(
  tool: ActionToolDefinition,
  policies: ActionPolicies,
  labels: ActionLabels = {},
): ToolView {
  return {
    name: tool.name,
    title: actionToolTitle(tool),
    description: actionToolDescription(tool),
    readOnly: tool.annotations?.readOnlyHint === true,
    destructive: tool.annotations?.destructiveHint === true,
    openWorld: tool.annotations?.openWorldHint === true,
    policy: policies[tool.name] ?? "off",
    suggested: suggestedPolicy(tool),
    label: labels[tool.name] ?? "",
  };
}

export function serverView(row: ActionServerRow): ServerView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    transport: row.transport,
    authKind: row.authKind,
    authHeaderName: row.authHeaderName ?? "",
    secretMasked: row.authSecret ? maskSecret(row.authSecret, 4) : null,
    identity: row.identity,
    exchangeClientId: row.exchangeClientId ?? "",
    exchangeSecretMasked: row.exchangeClientSecret ? maskSecret(row.exchangeClientSecret, 4) : null,
    exchangeAudience: row.exchangeAudience ?? "",
    exchangeScope: row.exchangeScope ?? "",
    enabled: row.enabled,
    status: row.status,
    lastError: row.lastError,
    serverInfo: row.serverInfo,
    toolsFetchedAt: row.toolsFetchedAt?.toISOString() ?? null,
    tools: (row.tools ?? []).map((tool) => toolView(tool, row.policies, row.labels)),
  };
}

export interface ServerFormInput {
  name: string;
  slug: string;
  url: string;
  transport: string;
  authKind: string;
  authHeaderName: string;
  /** Empty keeps the stored secret; "remove" on `authKind: none` drops it. */
  authSecret: string;
  identity: string;
  exchangeClientId: string;
  /** Empty keeps the stored exchange secret. */
  exchangeClientSecret: string;
  exchangeAudience: string;
  exchangeScope: string;
  enabled: boolean;
}

/** The row's shape after a merge: the validated config plus both secrets, null where unused. */
export type MergedServer = ActionServerConfig & {
  authSecret: string | null;
  exchangeClientSecret: string | null;
};

export type ServerMergeResult = { ok: true; server: MergedServer } | { ok: false; error: string };

/** A slug from a name: lowercase, dashes, trimmed to the limit. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ACTION_LIMITS.slug)
    .replace(/-+$/g, "");
}

export function mergeServerSettings(
  stored: Pick<ActionServerRow, "authSecret" | "exchangeClientSecret"> | null,
  form: ServerFormInput,
): ServerMergeResult {
  const visitor = form.identity === "visitor";
  const parsed = ActionServerSchema.safeParse({
    name: form.name,
    slug: form.slug.trim() || slugify(form.name),
    url: form.url.trim(),
    transport: form.transport || "http",
    authKind: form.authKind || "none",
    authHeaderName: form.authHeaderName.trim() || undefined,
    identity: form.identity || "none",
    // The exchange fields mean nothing outside the visitor mode and are
    // dropped rather than kept around to confuse a later read.
    exchangeClientId: (visitor && form.exchangeClientId.trim()) || undefined,
    exchangeAudience: (visitor && form.exchangeAudience.trim()) || undefined,
    exchangeScope: (visitor && form.exchangeScope.trim()) || undefined,
    enabled: form.enabled,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue ? `${issue.path.join(".") || "server"}: ${issue.message}` : "Invalid settings",
    };
  }
  const server = parsed.data;
  const url = validateWebhookUrl(server.url);
  if (!url.ok) return { ok: false, error: `URL: ${url.reason}` };
  server.url = url.url;
  if (server.authKind === "header" && !server.authHeaderName) {
    return { ok: false, error: "A header credential needs the header's name." };
  }
  if (server.identity === "visitor" && server.authKind === "bearer") {
    return {
      ok: false,
      error:
        "The visitor's token is the bearer; give the server's own credential as a custom header, or none.",
    };
  }
  let authSecret: string | null = null;
  if (server.authKind !== "none") {
    const fresh = form.authSecret.trim();
    if (fresh.length > ACTION_LIMITS.secret) {
      return { ok: false, error: "The credential is too long." };
    }
    authSecret = fresh || stored?.authSecret || null;
    if (!authSecret) return { ok: false, error: "Paste the credential the server expects." };
  }
  let exchangeClientSecret: string | null = null;
  if (server.exchangeClientId) {
    const fresh = form.exchangeClientSecret.trim();
    if (fresh.length > ACTION_LIMITS.secret) {
      return { ok: false, error: "The exchange client secret is too long." };
    }
    exchangeClientSecret = fresh || stored?.exchangeClientSecret || null;
    if (!exchangeClientSecret) {
      return { ok: false, error: "Paste the exchange client's secret." };
    }
  }
  return { ok: true, server: { ...server, authSecret, exchangeClientSecret } };
}

/**
 * Policies from a form: one field per known tool, values outside the three
 * are dropped, and tools the server no longer lists are forgotten so a
 * renamed tool does not keep a permission under its old name.
 */
export function mergePolicies(
  tools: ActionToolDefinition[],
  values: Record<string, string>,
): ActionPolicies {
  const next: Record<string, string> = {};
  for (const tool of tools) {
    const value = values[tool.name];
    if (value === "allow" || value === "confirm") next[tool.name] = value;
  }
  const parsed = ActionPoliciesSchema.safeParse(next);
  return parsed.success ? parsed.data : {};
}

/**
 * Labels from a form (spec: action-presentation): one field per known tool,
 * blank means the derived title, too long is cut rather than refused, and
 * tools the server no longer lists are forgotten.
 */
export function mergeLabels(
  tools: ActionToolDefinition[],
  values: Record<string, string>,
): ActionLabels {
  const next: Record<string, string> = {};
  for (const tool of tools) {
    const value = values[tool.name]?.trim().slice(0, ACTION_LIMITS.label);
    if (value) next[tool.name] = value;
  }
  const parsed = ActionLabelsSchema.safeParse(next);
  return parsed.success ? parsed.data : {};
}
