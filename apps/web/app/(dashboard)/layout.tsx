import { SidebarInset, SidebarProvider } from "@deskbell/ui/components/sidebar";
import { Toaster } from "@deskbell/ui/components/sonner";
import { type CSSProperties, type ReactNode, Suspense } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { GitHubStars } from "@/components/github-stars";
import { WidgetEmbed } from "@/components/widget-embed";
import { requireMember } from "@/lib/auth/session";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // requireMember also runs inside getDefaultProject; both are request-cached,
  // so this costs nothing extra and gives the sidebar the real user + role.
  const [{ session, role }, project] = await Promise.all([requireMember(), getDefaultProject()]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        user={{ name: session.user.name, email: session.user.email }}
        starBadge={
          <Suspense fallback={null}>
            <GitHubStars />
          </Suspense>
        }
      />
      {/* min-w-0: as a flex item beside the sidebar the inset would otherwise
          refuse to shrink below its content's intrinsic width — three fixed
          panes on the thread page pushed it past a 1280px viewport. */}
      <SidebarInset className="min-w-0">{children}</SidebarInset>
      <WidgetEmbed projectKey={project.publicKey} />
      <CommandPalette role={role} />
      {/* Settings that save the moment they change (a tool policy, a server's
          switch) confirm through a toast rather than a line that lingers. */}
      <Toaster position="bottom-center" />
    </SidebarProvider>
  );
}
