import { notificationDeliveries } from "@deskbell/db";
import type { NotificationChannelId } from "@deskbell/shared";
import { and, desc, eq } from "drizzle-orm";

import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { type DeliveryView, notificationsView } from "@/lib/notifications/settings";
import { getDefaultProject } from "@/lib/org";

import { NotificationsForm } from "./notifications-form";

export const dynamic = "force-dynamic";

/**
 * Notifications — where the project is told about events (spec:
 * project-notifications). The page hands the form a view with targets
 * masked and the latest delivery per channel; the stored URLs and the
 * signing secret never reach the client.
 */
export default async function NotificationsPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";

  // The latest row per channel: a handful of recent rows, first hit per channel.
  const recent = await getDb()
    .select({
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      error: notificationDeliveries.error,
      updatedAt: notificationDeliveries.updatedAt,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.orgId, project.orgId),
        eq(notificationDeliveries.projectId, project.id),
      ),
    )
    .orderBy(desc(notificationDeliveries.updatedAt))
    .limit(20);
  const lastDelivery: Partial<Record<NotificationChannelId, DeliveryView>> = {};
  for (const row of recent) {
    const channel = row.channel as NotificationChannelId;
    lastDelivery[channel] ??= {
      status: row.status,
      at: row.updatedAt.toISOString(),
      error: row.error,
    };
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Tell a Slack channel or your own endpoint when something needs a person: a visitor marking an answer down, to start with. Each channel chooses which events it gets."
      />
      <NotificationsForm
        view={notificationsView(project.notifications, lastDelivery)}
        canEdit={canEdit}
      />
    </>
  );
}
