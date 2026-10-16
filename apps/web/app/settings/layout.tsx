import { Separator } from "@deskbell/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@deskbell/ui/components/sidebar";
import { Toaster } from "@deskbell/ui/components/sonner";
import type { CSSProperties, ReactNode } from "react";

import { CommandPalette } from "@/components/command-palette";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { WidgetEmbed } from "@/components/widget-embed";
import { requireMember } from "@/lib/auth/session";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * The settings shell (spec: dashboard-ia-settings): a sibling of the
 * (dashboard) segment so it replaces the whole chrome — App Router layouts
 * compose, they never override. Narrow grouped sub-sidebar, back link,
 * centered content column. Same auth wiring as the dashboard shell; both
 * calls are request-cached so this costs nothing extra.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 56)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <SettingsSidebar variant="inset" role={role} />
      {/* min-w-0: same as the dashboard shell — the inset must be allowed to
          shrink below its content's intrinsic width beside the sidebar. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
          {/* The trigger is what opens the sidebar sheet on mobile. */}
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
            <span className="text-base font-medium text-muted-foreground">Settings</span>
          </div>
        </header>
        {/* Left-aligned, not viewport-centered: the appearance page's live widget
            preview owns the bottom-right corner, so a centered column would run
            underneath it (spec: dashboard-ia-settings). */}
        <div className="flex w-full max-w-3xl flex-1 flex-col gap-8 p-4 lg:p-6">{children}</div>
      </SidebarInset>
      <WidgetEmbed projectKey={project.publicKey} />
      <CommandPalette role={role} />
      {/* Settings that save the moment they change (a tool policy, a server's
          switch) confirm through a toast rather than a line that lingers. */}
      <Toaster position="bottom-center" />
    </SidebarProvider>
  );
}
