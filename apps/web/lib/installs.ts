import { widgetInstalls } from "@deskbell/db";
import { newId } from "@deskbell/shared";
import { and, count, eq } from "drizzle-orm";

import { getDb } from "./db";
import { normalizeOrigin } from "./origins";

/**
 * Record that a project's widget was seen on an origin
 * (spec: single-tag-embed-deploy-onboarding).
 *
 * Two callers, one implementation on purpose. `/api/v1/ping` reports a widget
 * that mounted; `/api/v1/ask` reports one that actually answered a question —
 * a custom UI built on @deskbell/sdk never fires the beacon, and before this
 * the Deploy page told those customers their widget was pending while it was
 * busy answering. Both are public unauthenticated writes, so the MAX_ORIGINS
 * cap and normalizeOrigin() are the abuse boundary; duplicating them is how
 * one copy drifts open.
 *
 * Diagnostic, never authorization: non-allowlisted origins are recorded on
 * purpose, because "widget seen on X — not in your allowlist" is the misconfig
 * hint the Deploy page shows.
 *
 * Never throws. Telemetry must not be able to fail an answer or a beacon.
 */

const MAX_ORIGINS = 100;

export async function recordInstall(
  project: { id: string; orgId: string },
  rawOrigin: string | null,
): Promise<void> {
  // Browsers append Origin to every request whose method is not GET or HEAD,
  // same-origin included (it is why Origin-based CSRF checks work at all), and
  // in canonical form — so both routes, being POST, see it from any browser.
  // Normalizing rejects the opaque "null" origin and anything hand-crafted.
  // A server-side caller sends no Origin and is invisible to origin-keyed
  // verification by construction; the Deploy page names that case rather than
  // reporting it as "not installed".
  const origin = normalizeOrigin(rawOrigin ?? "");
  if (!origin) return;

  try {
    const db = getDb();
    const scope = and(
      eq(widgetInstalls.orgId, project.orgId),
      eq(widgetInstalls.projectId, project.id),
    );
    const existing = await db.query.widgetInstalls.findFirst({
      where: and(scope, eq(widgetInstalls.origin, origin)),
    });
    if (existing) {
      await db
        .update(widgetInstalls)
        .set({ lastSeenAt: new Date() })
        .where(eq(widgetInstalls.id, existing.id));
      return;
    }
    // The cap counts only when inserting: an established origin keeps
    // reporting even once a project has hit the limit.
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(widgetInstalls).where(scope);
    if (n >= MAX_ORIGINS) return;
    await db
      .insert(widgetInstalls)
      .values({ id: newId("wi"), orgId: project.orgId, projectId: project.id, origin })
      .onConflictDoUpdate({
        target: [widgetInstalls.projectId, widgetInstalls.origin],
        set: { lastSeenAt: new Date() },
      });
  } catch {
    // Install verification is diagnostic; losing a row is not worth a 500.
  }
}
