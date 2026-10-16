import { asc, eq } from "drizzle-orm";

import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * The session's workspace (spec: dashboard-auth): the oldest project in the
 * signed-in member's active organization. Every dashboard page and server
 * action resolves data through here, which makes this call the security
 * boundary — no session + membership, no project, no query.
 *
 * Oldest-project is still the rule because the dashboard is single-project
 * for now; a project switcher changes this function and nothing else.
 */
export async function getDefaultProject() {
  const { session } = await requireMember();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    throw new Error("Session has no active organization — sign out and back in.");
  }
  const db = getDb();
  const project = await db.query.projects.findFirst({
    where: (p) => eq(p.orgId, orgId),
    orderBy: (p) => [asc(p.createdAt)],
  });
  if (!project) {
    throw new Error("No project found — run `pnpm db:seed` (dx does this automatically).");
  }
  return project;
}
