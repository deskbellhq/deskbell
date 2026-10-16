import type { ReactNode } from "react";

import { InboxShell } from "@/components/conversations-inbox";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

/**
 * Two panes. The list is the `@list` parallel slot rather than a fetch here,
 * because a layout never sees the search params and the list is a view of
 * them (spec: conversations-date-range); the thread is `children`.
 */
export default function ConversationsLayout({
  children,
  list,
}: {
  children: ReactNode;
  list: ReactNode;
}) {
  return (
    <>
      <SiteHeader title="Conversations" />
      <InboxShell list={list}>{children}</InboxShell>
    </>
  );
}
