import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

/**
 * D12 baseline roles (spec: dashboard-auth). Client-safe — imported by both
 * the server auth instance and the browser auth client, so nothing server-only
 * may leak in here.
 *
 * Two app resources on top of the plugin's org/member/invitation statements:
 * - `project`: sources, appearance, onboarding — day-to-day content work.
 * - `deploy`: origin allowlist and token budget — the controls that protect
 *   the operator's LLM spend, so they need a higher bar than content edits.
 */
const statement = {
  ...defaultStatements,
  project: ["read", "update"],
  deploy: ["update"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    project: ["read", "update"],
    deploy: ["update"],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    project: ["read", "update"],
    deploy: ["update"],
  }),
  editor: ac.newRole({
    project: ["read", "update"],
  }),
  viewer: ac.newRole({
    project: ["read"],
  }),
};

export type DashboardRole = keyof typeof roles;

/**
 * Strict ordering for "at least this role" checks. Owner outranks admin only
 * for org deletion/transfer — both disabled in v1 — so no v1 gate requires
 * owner; the rank exists so one does not get invented ad hoc later.
 */
export const ROLE_RANK: Record<DashboardRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function isDashboardRole(role: string): role is DashboardRole {
  return role in ROLE_RANK;
}

/** Roles an admin may hand out from the dashboard. Owner is not assignable in v1. */
export const ASSIGNABLE_ROLES = [
  "viewer",
  "editor",
  "admin",
] as const satisfies readonly DashboardRole[];
