"use server";

import { projects } from "@deskbell/db";
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventToggles,
  newSigningSecret,
} from "@deskbell/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { mergeNotificationSettings } from "@/lib/notifications/settings";
import { getDefaultProject } from "@/lib/org";

/**
 * Notification settings (spec: project-notifications). Stored on the
 * project as a validated document. Admin-gated like the allowlist: the
 * targets are bearer-equivalent URLs and a signing secret. The merge is
 * pure and unit-tested; this file reads the form and writes the row.
 */

export interface NotificationsFormState {
  error?: string;
  saved?: boolean;
  /** Shown once, right after a webhook target was set for the first time or its secret rotated. */
  revealedSecret?: string;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function toggles(formData: FormData, prefix: string): NotificationEventToggles {
  return Object.fromEntries(
    NOTIFICATION_EVENT_TYPES.map((t) => [t, formData.get(`${prefix}.${t}`) === "on"]),
  );
}

export async function saveNotifications(
  _prev: NotificationsFormState | undefined,
  formData: FormData,
): Promise<NotificationsFormState> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };

  const project = await getDefaultProject();
  const merged = mergeNotificationSettings(
    project.notifications,
    {
      slackUrl: field(formData, "slackUrl"),
      slackRemove: formData.get("slackRemove") === "on",
      slackEvents: toggles(formData, "slack"),
      slackTemplates: Object.fromEntries(
        NOTIFICATION_EVENT_TYPES.map((t) => [t, String(formData.get(`slack.template.${t}`) ?? "")]),
      ),
      webhookUrl: field(formData, "webhookUrl"),
      webhookRemove: formData.get("webhookRemove") === "on",
      webhookEvents: toggles(formData, "webhook"),
      conversationLinkTemplate: field(formData, "conversationLinkTemplate"),
    },
    newSigningSecret,
  );
  if (!merged.ok) return { error: merged.error };

  await getDb()
    .update(projects)
    .set({ notifications: merged.settings, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/notifications");
  return {
    saved: true,
    ...(merged.revealedSecret ? { revealedSecret: merged.revealedSecret } : {}),
  };
}

/** A new signing secret for the webhook channel; the old one stops verifying at once. */
export async function rotateSigningSecret(): Promise<{ secret?: string; error?: string }> {
  const gate = await checkRole("admin");
  if (gate.error) return { error: gate.error };
  const project = await getDefaultProject();
  const webhook = project.notifications.channels?.webhook;
  if (!webhook) return { error: "Set a webhook URL first." };
  const secret = newSigningSecret();
  await getDb()
    .update(projects)
    .set({
      notifications: {
        ...project.notifications,
        channels: {
          ...project.notifications.channels,
          webhook: { ...webhook, signingSecret: secret },
        },
      },
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, project.id), eq(projects.orgId, project.orgId)));
  revalidatePath("/settings/notifications");
  return { secret };
}
