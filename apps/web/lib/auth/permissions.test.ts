import { describe, expect, it } from "vitest";

import { ASSIGNABLE_ROLES, isDashboardRole, ROLE_RANK, roles } from "./permissions";

describe("role rank", () => {
  it("orders viewer < editor < admin < owner", () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });

  it("mirrors the v1 gate matrix: content needs editor, deploy/members need admin", () => {
    const atLeast = (role: keyof typeof ROLE_RANK, min: keyof typeof ROLE_RANK) =>
      ROLE_RANK[role] >= ROLE_RANK[min];
    // sources / appearance / onboarding
    expect(atLeast("viewer", "editor")).toBe(false);
    expect(atLeast("editor", "editor")).toBe(true);
    // origin allowlist / token budget / members
    expect(atLeast("editor", "admin")).toBe(false);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("owner", "admin")).toBe(true);
  });

  it("recognises exactly the four D12 roles", () => {
    for (const role of ["owner", "admin", "editor", "viewer"]) {
      expect(isDashboardRole(role)).toBe(true);
    }
    expect(isDashboardRole("member")).toBe(false); // the plugin default we replaced
    expect(isDashboardRole("")).toBe(false);
  });

  it("never offers owner from the dashboard", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
  });
});

describe("access-control statements", () => {
  it("gives editors project access but no deploy or member management", () => {
    expect(roles.editor.statements.project).toEqual(["read", "update"]);
    expect(roles.editor.statements).not.toHaveProperty("deploy");
    expect(roles.editor.statements).not.toHaveProperty("invitation");
  });

  it("keeps viewers read-only", () => {
    expect(roles.viewer.statements.project).toEqual(["read"]);
    expect(roles.viewer.statements).not.toHaveProperty("deploy");
  });

  it("lets admin and owner manage deploy settings", () => {
    expect(roles.admin.statements.deploy).toEqual(["update"]);
    expect(roles.owner.statements.deploy).toEqual(["update"]);
  });
});
